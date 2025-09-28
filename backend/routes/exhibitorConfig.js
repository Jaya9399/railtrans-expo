const express = require("express");
const router = express.Router();
const db = require("../db");

// GET exhibitor config
router.get("/", async (req, res) => {
  try {
    // For mysql2: [rows] = await db.execute(...)
    // For mysql: rows = await db.execute(...)
    let rows;
    try {
      const dbResult = await db.execute(
        "SELECT config_json FROM registration_page_config WHERE page = ? LIMIT 1",
        ["exhibitor"]
      );
      // Handle both mysql2 ([rows]) and mysql (rows)
      if (Array.isArray(dbResult)) {
        rows = dbResult[0] && Array.isArray(dbResult[0]) ? dbResult[0] : dbResult;
      } else {
        rows = dbResult;
      }
    } catch (dbErr) {
      console.error("DB query error:", dbErr);
      return res.status(500).json({ error: "Database query failed", fields: [], images: [], eventDetails: {} });
    }

    // Debug: log rows returned from DB
    console.log("DB rows received:", rows);

    if (!rows || rows.length === 0 || !rows[0].config_json) {
      console.warn("No config found or config_json missing for exhibitor.");
      return res.json({ fields: [], images: [], eventDetails: {} });
    }

    // Debug: log raw config_json string
    console.log("Raw config_json from DB:", rows[0].config_json);

    let config;
    try {
      config = JSON.parse(rows[0].config_json);
    } catch (e) {
      console.error("JSON parse error:", e);
      return res.json({ fields: [], images: [], eventDetails: {} });
    }

    // Defensive: Ensure keys always exist
    config.fields = Array.isArray(config.fields) ? config.fields : [];
    config.images = Array.isArray(config.images) ? config.images : [];
    config.eventDetails = typeof config.eventDetails === "object" && config.eventDetails !== null ? config.eventDetails : {};

    // Debug: log final config sent to frontend
    console.log("Final exhibitor config sent:", config);

    res.json(config);
  } catch (err) {
    console.error("General error in exhibitor config route:", err);
    res.json({ fields: [], images: [], eventDetails: {} });
  }
});

// POST new exhibitor config (admin panel)
router.post("/config", async (req, res) => {
  const config = req.body;
  try {
    await db.execute(
      "UPDATE registration_page_config SET config_json = ? WHERE page = ?",
      [JSON.stringify(config), "exhibitor"]
    );
    res.json({ success: true });
  } catch (err) {
    console.error("Config update error:", err);
    res.status(500).json({ error: "Database update failed" });
  }
});

// PUT update exhibitor record
router.put("/:id", async (req, res) => {
  const { id } = req.params;
  const fields = req.body;

  try {
    const updates = Object.keys(fields)
      .map((k) => `${k} = ?`)
      .join(", ");
    const values = Object.values(fields);
    values.push(id);
    await db.execute(`UPDATE exhibitors SET ${updates} WHERE id = ?`, values);
    res.json({ success: true });
  } catch (err) {
    console.error("Exhibitor update error:", err);
    res.status(500).json({ error: "Database update failed" });
  }
});

// DELETE exhibitor record
router.delete("/:id", async (req, res) => {
  const { id } = req.params;
  try {
    await db.execute("DELETE FROM exhibitors WHERE id = ?", [id]);
    res.json({ success: true });
  } catch (err) {
    console.error("Exhibitor delete error:", err);
    res.status(500).json({ error: "Database delete failed" });
  }
});

module.exports = router;