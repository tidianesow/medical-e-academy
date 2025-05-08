const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { verifyTeacher } = require('../middleware/auth');
const axios = require('axios');
const jwt = require('jsonwebtoken');
require('dotenv').config();

async function calculateSimilarity(studentAnswer, correctAnswer) {
  try {
    const response = await axios.post(
      'https://api-inference.huggingface.co/models/sentence-transformers/all-MiniLM-L6-v2',
      {
        inputs: {
          source_sentence: correctAnswer,
          sentences: [studentAnswer],
        },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.HUGGINGFACE_API_KEY}`,
        },
      }
    );

    const similarityScore = response.data[0];
    return similarityScore;
  } catch (err) {
    console.error('Erreur lors du calcul de similarité:', err.message);
    return 0;
  }
}

function generateFeedback(similarityScore, studentAnswer, correctAnswer) {
  const scorePercentage = Math.round(similarityScore * 100);

  let feedback = '';
  if (scorePercentage >= 90) {
    feedback = 'Excellent travail ! Votre réponse est très proche de la réponse correcte.';
  } else if (scorePercentage >= 70) {
    feedback = 'Bon travail, mais il y a quelques différences avec la réponse correcte. Voici la réponse attendue : ' + correctAnswer;
  } else if (scorePercentage >= 50) {
    feedback = 'Votre réponse a quelques points corrects, mais elle manque de précision. Voici la réponse correcte : ' + correctAnswer;
  } else {
    feedback = 'Votre réponse est assez éloignée de la réponse correcte. Veuillez réviser. Réponse correcte : ' + correctAnswer;
  }

  return { grade: scorePercentage, feedback };
}

async function awardBadges(userId) {
  // Récupérer les soumissions de l'utilisateur
  const submissionsQuery = `
    SELECT DISTINCT exercise_id, grade
    FROM submissions
    WHERE user_id = ?
  `;
  
  db.query(submissionsQuery, [userId], (err, submissions) => {
    if (err) {
      console.error('Erreur lors de la récupération des soumissions pour les badges:', err.message);
      return;
    }

    // Critère 1 : Complétion de 5 exercices différents
    const completedExercisesCount = submissions.length;
    if (completedExercisesCount >= 5) {
      db.query(
        'SELECT * FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = ? AND b.criteria = ?',
        [userId, 'complete_5_exercises'],
        (err, badgeResults) => {
          if (err) {
            console.error('Erreur lors de la vérification du badge complete_5_exercises:', err.message);
            return;
          }
          if (badgeResults.length === 0) {
            db.query(
              'INSERT INTO user_badges (user_id, badge_id) SELECT ?, id FROM badges WHERE criteria = ?',
              [userId, 'complete_5_exercises'],
              (err) => {
                if (err) {
                  console.error('Erreur lors de l’attribution du badge complete_5_exercises:', err.message);
                } else {
                  console.log(`Badge "Complétion de 5 exercices" attribué à l'utilisateur ${userId}`);
                }
              }
            );
          }
        }
      );
    }

    // Critère 2 : Note ≥ 90 sur 3 exercices différents
    const highScoreSubmissions = submissions.filter(submission => submission.grade >= 90);
    if (highScoreSubmissions.length >= 3) {
      db.query(
        'SELECT * FROM user_badges ub JOIN badges b ON ub.badge_id = b.id WHERE ub.user_id = ? AND b.criteria = ?',
        [userId, 'high_score_3_exercises'],
        (err, badgeResults) => {
          if (err) {
            console.error('Erreur lors de la vérification du badge high_score_3_exercises:', err.message);
            return;
          }
          if (badgeResults.length === 0) {
            db.query(
              'INSERT INTO user_badges (user_id, badge_id) SELECT ?, id FROM badges WHERE criteria = ?',
              [userId, 'high_score_3_exercises'],
              (err) => {
                if (err) {
                  console.error('Erreur lors de l’attribution du badge high_score_3_exercises:', err.message);
                } else {
                  console.log(`Badge "Expert en diagnostic" attribué à l'utilisateur ${userId}`);
                }
              }
            );
          }
        }
      );
    }
  });
}

router.get('/', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  let query = 'SELECT * FROM exercises';
  let queryParams = [];

  if (token) {
    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      query += ' WHERE created_by = ?';
      queryParams.push(decoded.id);
    } catch (err) {
      console.error('Erreur lors de la vérification du token:', err.message);
      // Si le token est invalide, on continue sans filtrer (pour les étudiants)
    }
  }

  db.query(query, queryParams, (err, results) => {
    if (err) {
      console.error('Erreur lors de la récupération des exercices:', err.message);
      return res.status(500).json({ message: 'Erreur serveur' });
    }
    res.json(results);
  });
});

router.post('/', verifyTeacher, (req, res) => {
  const { title, study_id, question, correct_answer } = req.body;

  if (!title || !study_id || !question || !correct_answer) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }

  db.query(
    'INSERT INTO exercises (title, study_id, question, correct_answer, created_by) VALUES (?, ?, ?, ?, ?)',
    [title, study_id, question, correct_answer, req.user.id],
    (err) => {
      if (err) {
        return res.status(500).json({ message: 'Erreur lors de la création' });
      }
      res.status(201).json({ message: 'Exercice créé avec succès' });
    }
  );
});

router.put('/:id', verifyTeacher, (req, res) => {
  const { title, study_id, question, correct_answer } = req.body;
  const exerciseId = req.params.id;

  if (!title || !study_id || !question || !correct_answer) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }

  db.query(
    'UPDATE exercises SET title = ?, study_id = ?, question = ?, correct_answer = ? WHERE id = ? AND created_by = ?',
    [title, study_id, question, correct_answer, exerciseId, req.user.id],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Erreur lors de la modification' });
      }
      if (results.affectedRows === 0) {
        return res.status(404).json({ message: 'Exercice non trouvé ou non autorisé' });
      }
      res.json({ message: 'Exercice modifié avec succès' });
    }
  );
});

router.delete('/:id', verifyTeacher, (req, res) => {
  const exerciseId = req.params.id;

  // Étape 1 : Supprimer les soumissions associées
  db.query(
    'DELETE FROM submissions WHERE exercise_id = ?',
    [exerciseId],
    (err, submissionResults) => {
      if (err) {
        console.error('Erreur lors de la suppression des soumissions:', err.message);
        return res.status(500).json({ message: 'Erreur lors de la suppression des soumissions', error: err.message });
      }

      console.log(`Nombre de soumissions supprimées pour l'exercice ${exerciseId} : ${submissionResults.affectedRows}`);

      // Étape 2 : Supprimer l'exercice
      db.query(
        'DELETE FROM exercises WHERE id = ? AND created_by = ?',
        [exerciseId, req.user.id],
        (err, exerciseResults) => {
          if (err) {
            console.error('Erreur lors de la suppression de l’exercice:', err.message);
            return res.status(500).json({ message: 'Erreur lors de la suppression de l’exercice', error: err.message });
          }
          if (exerciseResults.affectedRows === 0) {
            console.log(`Exercice ${exerciseId} non trouvé ou non autorisé pour l'utilisateur ${req.user.id}`);
            return res.status(404).json({ message: 'Exercice non trouvé ou non autorisé' });
          }
          console.log(`Exercice ${exerciseId} supprimé avec succès par l'utilisateur ${req.user.id}`);
          res.json({ message: 'Exercice supprimé avec succès' });
        }
      );
    }
  );
});

router.get('/submissions', verifyTeacher, (req, res) => {
  db.query(
    'SELECT s.id, s.exercise_id, s.user_id, s.answer, s.submitted_at, s.grade, s.feedback, e.title, u.name AS student_name ' +
    'FROM submissions s ' +
    'JOIN exercises e ON s.exercise_id = e.id ' +
    'JOIN users u ON s.user_id = u.id ' +
    'WHERE e.created_by = ?',
    [req.user.id],
    (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Erreur serveur' });
      }
      res.json(results);
    }
  );
});

router.delete('/submissions/:id', verifyTeacher, (req, res) => {
  const submissionId = req.params.id;

  // Vérifier que la soumission appartient à un exercice créé par le professeur
  db.query(
    'SELECT s.id FROM submissions s JOIN exercises e ON s.exercise_id = e.id WHERE s.id = ? AND e.created_by = ?',
    [submissionId, req.user.id],
    (err, results) => {
      if (err) {
        console.error('Erreur lors de la vérification de la soumission:', err.message);
        return res.status(500).json({ message: 'Erreur serveur', error: err.message });
      }
      if (results.length === 0) {
        console.log(`Soumission ${submissionId} non trouvée ou non autorisée pour l'utilisateur ${req.user.id}`);
        return res.status(404).json({ message: 'Soumission non trouvée ou non autorisée' });
      }

      // Supprimer la soumission
      db.query(
        'DELETE FROM submissions WHERE id = ?',
        [submissionId],
        (err, deleteResults) => {
          if (err) {
            console.error('Erreur lors de la suppression de la soumission:', err.message);
            return res.status(500).json({ message: 'Erreur lors de la suppression', error: err.message });
          }
          console.log(`Soumission ${submissionId} supprimée avec succès par l'utilisateur ${req.user.id}`);
          res.json({ message: 'Soumission supprimée avec succès' });
        }
      );
    }
  );
});

router.get('/statistics', verifyTeacher, (req, res) => {
  // Requête 1 : Note moyenne et nombre de soumissions par exercice
  const exerciseStatsQuery = `
    SELECT 
      e.id, 
      e.title, 
      COUNT(s.id) AS submission_count, 
      ROUND(AVG(s.grade), 2) AS average_grade
    FROM exercises e
    LEFT JOIN submissions s ON e.id = s.exercise_id
    WHERE e.created_by = ?
    GROUP BY e.id, e.title
    ORDER BY e.id
  `;

  // Requête 2 : Meilleurs étudiants (basé sur la note moyenne)
  const topStudentsQuery = `
    SELECT 
      u.id, 
      u.name AS student_name, 
      ROUND(AVG(s.grade), 2) AS average_grade,
      COUNT(s.id) AS submission_count
    FROM users u
    JOIN submissions s ON u.id = s.user_id
    JOIN exercises e ON s.exercise_id = e.id
    WHERE e.created_by = ?
    GROUP BY u.id, u.name
    ORDER BY average_grade DESC
    LIMIT 3
  `;

  // Exécuter les deux requêtes
  db.query(exerciseStatsQuery, [req.user.id], (err, exerciseStats) => {
    if (err) {
      console.error('Erreur lors de la récupération des statistiques des exercices:', err.message);
      return res.status(500).json({ message: 'Erreur serveur', error: err.message });
    }

    db.query(topStudentsQuery, [req.user.id], (err, topStudents) => {
      if (err) {
        console.error('Erreur lors de la récupération des meilleurs étudiants:', err.message);
        return res.status(500).json({ message: 'Erreur serveur', error: err.message });
      }

      res.json({
        exerciseStats: exerciseStats,
        topStudents: topStudents,
      });
    });
  });
});

router.put('/submissions/:id/feedback', verifyTeacher, (req, res) => {
  const submissionId = req.params.id;
  const { feedback } = req.body;

  if (!feedback) {
    return res.status(400).json({ message: 'Le feedback est requis' });
  }

  // Vérifier que la soumission appartient à un exercice créé par le professeur
  db.query(
    'SELECT s.id FROM submissions s JOIN exercises e ON s.exercise_id = e.id WHERE s.id = ? AND e.created_by = ?',
    [submissionId, req.user.id],
    (err, results) => {
      if (err) {
        console.error('Erreur lors de la vérification de la soumission:', err.message);
        return res.status(500).json({ message: 'Erreur serveur', error: err.message });
      }
      if (results.length === 0) {
        console.log(`Soumission ${submissionId} non trouvée ou non autorisée pour l'utilisateur ${req.user.id}`);
        return res.status(404).json({ message: 'Soumission non trouvée ou non autorisée' });
      }

      // Mettre à jour le feedback
      db.query(
        'UPDATE submissions SET feedback = ? WHERE id = ?',
        [feedback, submissionId],
        (err, updateResults) => {
          if (err) {
            console.error('Erreur lors de la mise à jour du feedback:', err.message);
            return res.status(500).json({ message: 'Erreur lors de la mise à jour du feedback', error: err.message });
          }
          console.log(`Feedback de la soumission ${submissionId} mis à jour avec succès par l'utilisateur ${req.user.id}`);
          res.json({ message: 'Feedback mis à jour avec succès' });
        }
      );
    }
  );
});

router.get('/my-submissions', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    db.query(
      'SELECT s.id, s.exercise_id, s.answer, s.submitted_at, s.grade, s.feedback, e.title ' +
      'FROM submissions s ' +
      'JOIN exercises e ON s.exercise_id = e.id ' +
      'WHERE s.user_id = ?',
      [userId],
      (err, results) => {
        if (err) {
          console.error('Erreur lors de la récupération des soumissions:', err.message);
          return res.status(500).json({ message: 'Erreur serveur' });
        }
        res.json(results);
      }
    );
  } catch (err) {
    console.error('Erreur lors de la vérification du token:', err.message);
    return res.status(401).json({ message: 'Token invalide' });
  }
});

router.post('/submit', async (req, res) => {
  const { exercise_id, user_id, answer } = req.body;

  if (!exercise_id || !user_id || !answer) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }

  db.query(
    'SELECT correct_answer FROM exercises WHERE id = ?',
    [exercise_id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Erreur serveur' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: 'Exercice non trouvé' });
      }

      const correctAnswer = results[0].correct_answer;

      const similarityScore = await calculateSimilarity(answer, correctAnswer);

      const { grade, feedback } = generateFeedback(similarityScore, answer, correctAnswer);

      db.query(
        'INSERT INTO submissions (exercise_id, user_id, answer, grade, feedback) VALUES (?, ?, ?, ?, ?)',
        [exercise_id, user_id, answer, grade, feedback],
        (err) => {
          if (err) {
            return res.status(500).json({ message: 'Erreur lors de la soumission' });
          }

          // Attribuer les badges après la soumission
          awardBadges(user_id);

          res.status(201).json({
            message: 'Réponse soumise avec succès',
            grade,
            feedback,
          });
        }
      );
    }
  );
});

router.post('/evaluate', async (req, res) => {
  const { exercise_id, answer } = req.body;

  if (!exercise_id || !answer) {
    return res.status(400).json({ message: 'L\'identifiant de l\'exercice et la réponse sont requis' });
  }

  db.query(
    'SELECT correct_answer FROM exercises WHERE id = ?',
    [exercise_id],
    async (err, results) => {
      if (err) {
        return res.status(500).json({ message: 'Erreur serveur' });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: 'Exercice non trouvé' });
      }

      const correctAnswer = results[0].correct_answer;

      const similarityScore = await calculateSimilarity(answer, correctAnswer);

      const { grade, feedback } = generateFeedback(similarityScore, answer, correctAnswer);

      res.status(200).json({
        message: 'Évaluation réussie',
        grade,
        feedback,
      });
    }
  );
});

router.get('/badges', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    db.query(
      'SELECT b.id, b.name, b.description, ub.awarded_at ' +
      'FROM user_badges ub ' +
      'JOIN badges b ON ub.badge_id = b.id ' +
      'WHERE ub.user_id = ?',
      [userId],
      (err, results) => {
        if (err) {
          console.error('Erreur lors de la récupération des badges:', err.message);
          return res.status(500).json({ message: 'Erreur serveur' });
        }
        res.json(results);
      }
    );
  } catch (err) {
    console.error('Erreur lors de la vérification du token:', err.message);
    return res.status(401).json({ message: 'Token invalide' });
  }
});

router.get('/student-progress', (req, res) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const userId = decoded.id;

    // Requête 1 : Toutes les soumissions pour le graphique linéaire (évolution dans le temps)
    const submissionsQuery = `
      SELECT s.id, s.exercise_id, s.grade, s.submitted_at, e.title
      FROM submissions s
      JOIN exercises e ON s.exercise_id = e.id
      WHERE s.user_id = ?
      ORDER BY s.submitted_at ASC
    `;

    // Requête 2 : Note moyenne par exercice pour le graphique en barres
    const averageGradeQuery = `
      SELECT e.id, e.title, ROUND(AVG(s.grade), 2) AS average_grade
      FROM submissions s
      JOIN exercises e ON s.exercise_id = e.id
      WHERE s.user_id = ?
      GROUP BY e.id, e.title
      ORDER BY e.id
    `;

    // Exécuter les deux requêtes
    db.query(submissionsQuery, [userId], (err, submissions) => {
      if (err) {
        console.error('Erreur lors de la récupération des soumissions pour la progression:', err.message);
        return res.status(500).json({ message: 'Erreur serveur' });
      }

      db.query(averageGradeQuery, [userId], (err, averageGrades) => {
        if (err) {
          console.error('Erreur lors de la récupération des notes moyennes par exercice:', err.message);
          return res.status(500).json({ message: 'Erreur serveur' });
        }

        res.json({
          submissions: submissions, // Pour le graphique linéaire
          averageGrades: averageGrades, // Pour le graphique en barres
        });
      });
    });
  } catch (err) {
    console.error('Erreur lors de la vérification du token:', err.message);
    return res.status(401).json({ message: 'Token invalide' });
  }
});

module.exports = router;