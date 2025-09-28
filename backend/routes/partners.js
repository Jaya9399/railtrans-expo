const express = require('express');
const router = express.Router();
const { registerPartner } = require('../controllers/partnersController');
router.post('/', registerPartner);
module.exports = router;