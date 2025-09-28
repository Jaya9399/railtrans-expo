const express = require('express');
const router = express.Router();
const { registerVisitor } = require('../controllers/visitorsController');

router.post('/', registerVisitor);

module.exports = router;