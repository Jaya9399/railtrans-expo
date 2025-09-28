const express = require('express');
const router = express.Router();
const { registerExhibitor } = require('../controllers/exhibitorsController');

router.post('/', registerExhibitor);

module.exports = router;