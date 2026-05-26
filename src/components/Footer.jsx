import React from "react";

function safeHex(h) {
  if (!h) return null;
  const s = String(h).trim();
  return s.startsWith("#") ? s : `#${s}`;
}

function darkenHex(hex, amount = 0.12) {
  if (!hex) return "#1a1a1a";
  const h = safeHex(hex);
  if (!h) return "#1a1a1a";
  const cleaned = h.replace("#", "");
  const normalized = cleaned.length === 3 ? cleaned.split("").map((c) => c + c).join("") : cleaned;
  const bigint = parseInt(normalized, 16);
  const r = Math.max(0, Math.floor(((bigint >> 16) & 255) * (1 - amount)));
  const g = Math.max(0, Math.floor(((bigint >> 8) & 255) * (1 - amount)));
  const b = Math.max(0, Math.floor((bigint & 255) * (1 - amount)));
  return `#${((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1)}`;
}

export default function Footer({ primaryColor = "#196e87" }) {
  const footerBg = darkenHex(primaryColor, 0.3);
  const footerText = "#ffffff";
  const linkHover = "#ffba08";

  const links = [
    { label: "Privacy Policy", url: "https://www.railtransexpo.com/p/privacy-policy.html" },
    { label: "Terms of Use", url: "https://www.railtransexpo.com/p/terms-of-use.html" },
    { label: "Refund Policy", url: "https://www.railtransexpo.com/p/refund-policy.html" },
    { label: "Contact Us", url: "https://www.railtransexpo.com/p/contact.html" },
  ];

  return (
    <footer
      className="w-full py-6 px-4 md:px-6 mt-auto"
      style={{ backgroundColor: footerBg, color: footerText }}
    >
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        
        {/* Links */}
        <div className="flex flex-wrap justify-center gap-4 md:gap-6 text-sm">
          {links.map((link) => (
            <a
              key={link.label}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline transition-colors duration-200"
              style={{ color: footerText }}
              onMouseEnter={(e) => (e.target.style.color = linkHover)}
              onMouseLeave={(e) => (e.target.style.color = footerText)}
            >
              {link.label}
            </a>
          ))}
        </div>

        {/* Copyright */}
        <div className="text-sm text-center md:text-right" style={{ opacity: 0.9 }}>
          Copyright © Urban Infra Group 2026
        </div>
      </div>
    </footer>
  );
}