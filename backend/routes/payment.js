const express = require("express");
const router = express.Router();
const paymentsController = require("../controllers/paymentsController");

// Create a payment / order on provider and insert payments row
router.post("/create-order", express.json({ limit: "1mb" }), paymentsController.createOrder);

// Polling endpoint for frontend to check payment status
router.get("/status", paymentsController.status);

// Webhook endpoint: use raw body middleware to verify signature
router.post("/webhook", express.raw({ type: "application/json", limit: "1mb" }), paymentsController.webhookHandler);

module.exports = router;