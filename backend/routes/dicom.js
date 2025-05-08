const express = require('express');
const router = express.Router();
const axios = require('axios');
require('dotenv').config();

// Middleware pour ajouter les identifiants Orthanc
const auth = {
  auth: {
    username: process.env.ORTHANC_USER,
    password: process.env.ORTHANC_PASSWORD,
  },
};

// Lister les études (studies)
router.get('/studies', async (req, res) => {
  try {
    // Récupérer la liste des Orthanc IDs
    const studiesResponse = await axios.get(`${process.env.ORTHANC_URL}/studies`, auth);
    const orthancIds = studiesResponse.data;

    // Pour chaque Orthanc ID, récupérer les métadonnées et extraire le StudyInstanceUID
    const studies = [];
    for (const orthancId of orthancIds) {
      const studyResponse = await axios.get(`${process.env.ORTHANC_URL}/studies/${orthancId}`, auth);
      const studyData = studyResponse.data;

      // Extraire le StudyInstanceUID depuis les métadonnées DICOM
      const studyInstanceUID = studyData.MainDicomTags.StudyInstanceUID;
      if (studyInstanceUID) {
        studies.push(studyInstanceUID);
      }
    }

    console.log('StudyInstanceUIDs envoyés:', studies);
    res.json(studies);
  } catch (err) {
    console.error('Erreur Orthanc:', err.message);
    res.status(500).json({ message: 'Erreur lors de la récupération des études' });
  }
});

module.exports = router;