const express = require('express');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const dicomRoutes = require('./routes/dicom');
const exerciseRoutes = require('./routes/exercises');


const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());
app.use('/api/auth', authRoutes);
app.use('/api/dicom', dicomRoutes);
app.use('/api/exercises', exerciseRoutes);


app.get('/', (req, res) => {
  res.send('Bienvenue sur Medical e-Academy Backend !');
});

app.listen(port, () => {
  console.log(`Serveur démarré sur http://localhost:${port}`);
});