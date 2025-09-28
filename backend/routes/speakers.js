const express = require('express');
const router = express.Router();
const { registerSpeaker } = require('../controllers/speakersController');

router.post('/', registerSpeaker);

module.exports = router;