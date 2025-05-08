const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
require('dotenv').config();

// Inscription
router.post('/register', (req, res) => {
  const { name, email, password, role } = req.body;

  if (!name || !email || !password || !role) {
    return res.status(400).json({ message: 'Tous les champs sont requis' });
  }

  if (!['student', 'teacher', 'admin'].includes(role)) {
    return res.status(400).json({ message: 'Rôle invalide' });
  }

  // Vérifier si l'email existe déjà
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Erreur serveur' });
    }
    if (results.length > 0) {
      return res.status(400).json({ message: 'Email déjà utilisé' });
    }

    // Hacher le mot de passe
    const hashedPassword = bcrypt.hashSync(password, 10);

    // Insérer l'utilisateur
    db.query(
      'INSERT INTO users (name, email, password, role) VALUES (?, ?, ?, ?)',
      [name, email, hashedPassword, role],
      (err) => {
        if (err) {
          return res.status(500).json({ message: 'Erreur lors de l’inscription' });
        }
        res.status(201).json({ message: 'Inscription réussie' });
      }
    );
  });
});

// Connexion
router.post('/login', (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ message: 'Email et mot de passe requis' });
  }

  // Vérifier l'utilisateur
  db.query('SELECT * FROM users WHERE email = ?', [email], (err, results) => {
    if (err) {
      return res.status(500).json({ message: 'Erreur serveur' });
    }
    if (results.length === 0) {
      return res.status(400).json({ message: 'Email ou mot de passe incorrect' });
    }

    const user = results[0];

    // Vérifier le mot de passe
    if (!bcrypt.compareSync(password, user.password)) {
      return res.status(400).json({ message: 'Email ou mot de passe incorrect' });
    }

    // Générer un token JWT
    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: '1h' }
    );

    res.json({
      message: 'Connexion réussie',
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role },
    });
  });
});

module.exports = router;