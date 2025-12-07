const http = require("http");
const https = require("https");
const path = require("path");

function fetchBuffer(url, timeout = 15000) {
  return new Promise((resolve, reject) => {
    try {
      const u = new URL(url);
      const lib = u.protocol === "http:" ? http : https;
      const req = lib.get(u, { timeout }, (res) => {
        const status = res.statusCode || 0;
        if (status >= 400) {
          reject(new Error(`Failed to fetch ${url} - status ${status}`));
          res.resume();
          return;
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve({ buffer: Buffer.concat(chunks), contentType: res.headers["content-type"] || null }));
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error(`Timeout fetching ${url}`));
      });
    } catch (err) {
      reject(err);
    }
  });
}

async function fetchInlineLogo(logoUrl, cidName = "topbar-logo") {
  if (!logoUrl) return null;
  try {
    const { buffer, contentType } = await fetchBuffer(logoUrl);
    let filename = "logo";
    try {
      const u = new URL(logoUrl);
      filename = path.basename(u.pathname) || filename;
    } catch {}
    const attachment = {
      filename,
      content: buffer,
      contentType: contentType || "application/octet-stream",
      cid: `${cidName}@railtransexpo`,
    };
    return { attachment, cid: attachment.cid, filename, contentType: attachment.contentType };
  } catch (err) {
    console.warn("fetchInlineLogo failed:", err && err.message ? err.message : err);
    return null;
  }
}

function replaceLogoSrcWithCid(html, logoUrl, cid) {
  if (!html || !logoUrl || !cid) return html;
  const escaped = logoUrl.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
  const re = new RegExp(`(<img[^>]+src=(['"]?))${escaped}(['"]?[^>]*>)`, "i");
  if (re.test(html)) return html.replace(re, `$1cid:${cid}$3`);
  try {
    const u = new URL(logoUrl);
    const alt = u.origin + u.pathname;
    const escaped2 = alt.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
    const re2 = new RegExp(`(<img[^>]+src=(['"]?))${escaped2}(['"]?[^>]*>)`, "i");
    if (re2.test(html)) return html.replace(re2, `$1cid:${cid}$3`);
  } catch {}
  try {
    const name = (new URL(logoUrl)).pathname.split("/").pop();
    if (name) {
      const escName = name.replace(/[-/\\^$*+?.()|[\]{}]/g, "\\$&");
      const re3 = new RegExp(`(<img[^>]+src=(['"]?)[^>]*${escName}[^>]*(['"]?)[^>]*>)`, "i");
      if (re3.test(html)) {
        return html.replace(re3, (m) => m.replace(/src=(['"])[^'"]+\1/i, `src="cid:${cid}"`));
      }
    }
  } catch (e) {}
  return html;
}

module.exports = { fetchInlineLogo, replaceLogoSrcWithCid };