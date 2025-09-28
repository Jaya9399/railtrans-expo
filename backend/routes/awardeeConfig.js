const express = require("express");
const router = express.Router();
const db = require("../db");

// GET awardee config
router.get("/", async (req, res) => {
  try {
    const dbResult = await db.execute(
      "SELECT config_json FROM registration_page_config_awardee WHERE page = ? LIMIT 1",
      ["awardee"]
    );
    const rows = Array.isArray(dbResult[0]) ? dbResult[0] : dbResult;
    if (!rows || rows.length === 0 || !rows[0].config_json) {
      return res.json({ fields: [], images: [], eventDetails: {} });
    }
    let config;
    try {
      config = JSON.parse(rows[0].config_json);
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

// POST update awardee config
router.post("/config", async (req, res) => {
  const config = req.body;
  try {
    await db.execute(
      "UPDATE registration_page_config_awardee SET config_json = ? WHERE page = ?",
      [JSON.stringify(config), "awardee"]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: "Database update failed" });
  }
});

module.exports = router;