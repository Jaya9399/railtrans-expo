const express = require("express");
const router = express.Router();
const db = require("../db");

// GET partner config
router.get("/", async (req, res) => {
  try {
    const dbResult = await db.execute(
      "SELECT config_json FROM registration_page_config_partner WHERE page = ? LIMIT 1",
      ["partner"]
    );
    let rows = Array.isArray(dbResult) ? dbResult[0] : dbResult;
    if (!rows || (Array.isArray(rows) && rows.length === 0) || (rows && !rows.config_json)) {
      return res.json({ fields: [], images: [], eventDetails: {} });
    }
    let configJson = Array.isArray(rows) ? rows[0].config_json : rows.config_json;
    let config;
    try {
      config = JSON.parse(configJson);
    } catch (e) {
      return res.json({ fields: [], images: [], eventDetails: {} });
    }
    config.fields = Array.isArray(config.fields) ? config.fields : [];
    config.images = Array.isArray(config.images) ? config.images : [];
    config.eventDetails = typeof config.eventDetails === "object" && config.eventDetails !== null ? config.eventDetails : {};
    config.banner = config.banner || "";
    config.backgroundVideo = config.backgroundVideo || "";
    config.hostedByLogo = config.hostedByLogo || "";
    res.json(config);
  } catch (err) {
    res.json({ fields: [], images: [], eventDetails: {} });
  }
});

// POST update partner config
router.post("/config", async (req, res) => {
  const config = req.body;
  try {
    await db.execute(
      "UPDATE registration_page_config_partner SET config_json = ? WHERE page = ?",
      [JSON.stringify(config), "partner"]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database update failed" });
  }
});

// DELETE partner config
router.delete("/", async (req, res) => {
  try {
    await db.execute(
      "DELETE FROM registration_page_config_partner WHERE page = ?",
      ["partner"]
    );
    res.json({ success: true, message: "Partner config deleted." });
  } catch (err) {
    res.status(500).json({ error: "Database delete failed" });
  }
});

module.exports = router;