const express = require('express');
const router = express.Router();
const { registerAwardee } = require('../controllers/awardeesController');

router.post('/', registerAwardee);

module.exports = router;