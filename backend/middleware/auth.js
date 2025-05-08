const jwt = require('jsonwebtoken');
require('dotenv').config();

const verifyTeacher = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    return res.status(401).json({ message: 'Token requis' });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    if (decoded.role !== 'teacher') {
      return res.status(403).json({ message: 'Accès réservé aux professeurs' });
    }
    req.user = decoded;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Token invalide' });
  }
};

module.exports = { verifyTeacher };