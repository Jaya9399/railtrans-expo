// backend/routes/zohoAuth.js
const express = require("express");
const router = express.Router();
const { exchangeAuthCode } = require("../helpers/getZohoAccessToken");
const tokenStore = require("../utils/tokenStore");

const CLIENT_ID = process.env.ZOHO_CLIENT_ID || "";
const CLIENT_SECRET = process.env.ZOHO_CLIENT_SECRET || "";
const ACCOUNTS_HOST = process.env.ZOHO_ACCOUNTS_HOST || "accounts.zoho.com";
const REDIRECT_URI = process.env.ZOHO_REDIRECT_URI || `${process.env.APP_ORIGIN || `http://localhost:${process.env.PORT || 5000}`}/api/zoho/callback`;
// Default scopes — adjust per Zoho Payments docs if needed
const DEFAULT_SCOPES = process.env.ZOHO_OAUTH_SCOPES || "ZohoPayments.checkout.CREATE ZohoPayments.payments.READ";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.warn("Zoho OAuth route loaded but ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET are not set in env.");
}

/**
 * GET /api/zoho/auth-url
 * Returns the authorization URL for browser.
 */
router.get("/auth-url", (req, res) => {
  if (!CLIENT_ID) return res.status(400).json({ success: false, error: "ZOHO_CLIENT_ID not configured" });

  const params = new URLSearchParams({
    response_type: "code",
    client_id: CLIENT_ID,
    scope: DEFAULT_SCOPES,
    redirect_uri: REDIRECT_URI,
    access_type: "offline",
    prompt: "consent",
  });

  const url = `https://${ACCOUNTS_HOST}/oauth/v2/auth?${params.toString()}`;
  return res.json({ success: true, url });
});

/**
 * GET /api/zoho/callback?code=...
 * Zoho redirects here after user consents. Exchange code -> tokens and save refresh_token.
 */
router.get("/callback", async (req, res) => {
  const code = req.query.code;
  if (!code) {
    return res.status(400).send("<h2>Zoho OAuth callback error: missing code</h2>");
  }

  if (!CLIENT_ID || !CLIENT_SECRET) {
    return res.status(500).send("<h2>Server not configured with ZOHO_CLIENT_ID/SECRET</h2>");
  }

  try {
    const tokenRes = await exchangeAuthCode(code, CLIENT_ID, CLIENT_SECRET, REDIRECT_URI, { accountsHost: ACCOUNTS_HOST });
    // tokenRes: { access_token, refresh_token, expires_in, ... }
    tokenStore.saveTokens({
      refresh_token: tokenRes.refresh_token,
      access_token: tokenRes.access_token,
      expires_in: tokenRes.expires_in,
    });
    console.log("[Zoho] OAuth success — refresh_token saved to backend/.zoho_tokens.json");
    return res.send("<h2>Zoho OAuth completed successfully. Server has saved the refresh_token. You can close this window.</h2>");
  } catch (err) {
    console.error("[Zoho] callback exchange error:", err.message || err, err.provider || "");
    return res.status(500).send(`<h2>Zoho OAuth failed: ${String(err.message).replace(/</g, "&lt;")}</h2>`);
  }
});

module.exports = router;