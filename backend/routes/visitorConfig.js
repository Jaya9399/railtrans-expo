const express = require("express");
const router = express.Router();
const db = require("../db");

// GET visitor config
router.get("/", async (req, res) => {
  try {
    const dbResult = await db.execute(
      "SELECT config_json FROM registration_page_config_visitor WHERE page = ? LIMIT 1",
      ["visitor"]
    );
    // db.execute returns [rows, fields] (mysql2) -- but sometimes it may just return an object!
    let rows = Array.isArray(dbResult) ? dbResult[0] : dbResult;
    // Now rows could be an array or an object
    let configJson;
    if (Array.isArray(rows)) {
      if (!rows.length || !rows[0].config_json) {
        return res.json({ fields: [], images: [], eventDetails: {} });
      }
      configJson = rows[0].config_json;
    } else if (rows && rows.config_json) {
      configJson = rows.config_json;
    } else {
      return res.json({ fields: [], images: [], eventDetails: {} });
    }
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
    console.error("General error in visitor config route:", err);
    res.json({ fields: [], images: [], eventDetails: {} });
  }
});

// POST new visitor config (admin panel)
router.post("/config", async (req, res) => {
  const config = req.body;
  try {
    await db.execute(
      "UPDATE registration_page_config_visitor SET config_json = ? WHERE page = ?",
      [JSON.stringify(config), "visitor"]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Config update error:", err);
    res.status(500).json({ error: "Database update failed" });
  }
});

// DELETE visitor config
router.delete("/", async (req, res) => {
  try {
    await db.execute(
      "DELETE FROM registration_page_config_visitor WHERE page = ?",
      ["visitor"]
    );
    res.json({ success: true, message: "Visitor config deleted." });
  } catch (err) {
    console.error("Config delete error:", err);
    res.status(500).json({ error: "Database delete failed" });
  }
});

module.exports = router;