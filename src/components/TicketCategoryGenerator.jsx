import React, { useEffect, useState } from "react";

/**
 * TicketCategorySelector (manager-backed)
 *
 * - Reads ticket category amounts from localStorage (key: "ticket_categories_local_v1")
 *   which is managed by TicketPricingManager.
 * - If localStorage has no data, falls back to built-in defaults.
 * - When user selects a category, the callback receives price/gst/gstAmount/total/label
 *   derived from the pricing manager (not from any hard-coded defaults).
 *
 * Props:
 * - role: "visitors" | "exhibitors" | "partners" | "speakers" | "awardees" (optional)
 * - value: current selected value
 * - onChange(value, meta) : called when a category is selected. meta contains { price, gstRate, gstAmount, total, label }
 * - categories: optional override array of category objects - if supplied, will be used as source (but still merged with manager)
 *
 * This component intentionally prioritizes the client-side TicketPricingManager values.
 */

const DEFAULT_CATEGORIES_BY_ROLE = {
  visitors: [
    { value: "free", label: "Free", price: 0, gst: 0, features: ["Entry to Expo", "Access to General Sessions"], button: "Get Free Ticket" },
    { value: "premium", label: "Premium", price: 2500, gst: 0.18, features: ["Priority Access", "Premium Lounge", "E-Ticket with QR"], button: "Get Premium Ticket" },
    { value: "combo", label: "Combo", price: 5000, gst: 0.18, features: ["All Premium Benefits", "Multiple Slot Access"], button: "Get Combo Ticket" }
  ],
  exhibitors: [
    { value: "premium", label: "Premium", price: 5000, gst: 0.18, features: ["Premium exhibitor listing", "Booth access", "E-Ticket with QR"], button: "Get Premium" }
  ],
  partners: [
    { value: "premium", label: "Premium", price: 15000, gst: 0.18, features: ["Partner Branding", "Premium Booth", "Speaker slot"], button: "Get Premium" }
  ],
  speakers: [
    { value: "premium", label: "Premium", price: 0, gst: 0, features: ["Speaker pass", "Access to Speaker Lounge"], button: "Claim Speaker Pass" }
  ],
  awardees: [
    { value: "premium", label: "Premium", price: 0, gst: 0, features: ["Awardee pass", "Stage Access"], button: "Claim Awardee Pass" }
  ]
};

const LOCAL_STORAGE_KEY = "ticket_categories_local_v1";

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function formatCurrency(n) {
  const num = Number(n) || 0;
  return `₹${num.toLocaleString("en-IN")}`;
}

/* Read categories mapping from localStorage and normalize */
function readCategoriesFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

/* Normalize an array of category objects to canonical shape */
function normalizeCategoriesArray(arr, fallback = []) {
  if (!Array.isArray(arr)) return fallback;
  return arr.map((c, i) => ({
    value: (c && (c.value || c.key)) ? String(c.value || c.key) : `cat-${i}`,
    label: (c && c.label) ? String(c.label) : String(c.value || c.key || `Category ${i+1}`),
    price: safeNumber(c && (c.price ?? c.amount) ? (c.price ?? c.amount) : 0),
    gst: safeNumber(c && (c.gst ?? c.tax) ? (c.gst ?? c.tax) : 0),
    features: Array.isArray(c && c.features) ? c.features : (c && c.features ? [String(c.features)] : []),
    button: (c && c.button) ? String(c.button) : "Select"
  }));
}

/* Merge manager categories with a provided override: override takes precedence if provided */
function resolveCategories(role, overrideCategories) {
  // priority: overrideCategories (prop) -> localStorage -> defaults
  if (Array.isArray(overrideCategories) && overrideCategories.length) {
    return normalizeCategoriesArray(overrideCategories, DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
  }
  const local = readCategoriesFromLocalStorage();
  if (local && local[role] && Array.isArray(local[role]) && local[role].length) {
    return normalizeCategoriesArray(local[role], DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
  }
  return normalizeCategoriesArray(DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors, DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
}

/* Find a category by value (case-insensitive) in the provided lists */
function findCategoryByValue(value, categories) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return (categories || []).find(c => String(c.value).toLowerCase() === v) || null;
}

/* Best-effort fallback mapping for common aliases */
function fallbackCategoryMeta(value, role) {
  if (!value) return { price: 0, gst: 0, label: value || "" };
  const v = String(value).toLowerCase();
  // Use role-specific fallbacks
  if (v.includes("combo")) return { price: 5000, gst: 0.18, label: "Combo" };
  if (v.includes("premium")) {
    if (role === "partners") return { price: 15000, gst: 0.18, label: "Premium" };
    if (role === "exhibitors") return { price: 5000, gst: 0.18, label: "Premium" };
    return { price: 2500, gst: 0.18, label: "Premium" };
  }
  if (v.includes("free") || v.includes("general") || v === "0") return { price: 0, gst: 0, label: "Free" };
  if (v.includes("vip")) return { price: 7500, gst: 0.18, label: "VIP" };
  // default
  return { price: 2500, gst: 0.18, label: String(value) };
}

export default function TicketCategorySelector({ role = "visitors", value, onChange = () => {}, categories: categoriesProp }) {
  const [opts, setOpts] = useState(() => resolveCategories(role, categoriesProp));

  // When role or categoriesProp changes, re-resolve options
  useEffect(() => {
    setOpts(resolveCategories(role, categoriesProp));
  }, [role, categoriesProp]);

  // Listen for storage updates (TicketPricingManager may save to localStorage)
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        setOpts(resolveCategories(role, categoriesProp));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [role, categoriesProp]);

  // When user selects, derive meta from manager-backed opts first; fallback if missing
  const handleSelect = (opt) => {
    // opt may be an object from current opts; ensure we derive authoritative meta:
    const allOpts = resolveCategories(role, categoriesProp);
    // find by value in manager list (case-insensitive)
    const matched = findCategoryByValue(opt.value, allOpts) || null;
    let price, gstRate, gstAmount, total, label;
    if (matched) {
      price = safeNumber(matched.price);
      gstRate = safeNumber(matched.gst);
      gstAmount = Math.round(price * gstRate);
      total = price + gstAmount;
      label = matched.label || opt.label || String(opt.value);
    } else {
      // fallback heuristics
      const fb = fallbackCategoryMeta(opt.value, role);
      price = safeNumber(fb.price);
      gstRate = safeNumber(fb.gst);
      gstAmount = Math.round(price * gstRate);
      total = price + gstAmount;
      label = fb.label || opt.label || String(opt.value);
    }
    onChange(opt.value, { price, gstRate, gstAmount, total, label });
  };

  // Render using opts (manager-backed)
  return (
    <div className="flex flex-wrap justify-center gap-6 py-8 bg-white">
      {opts.map(opt => {
        const price = Number(opt.price || 0);
        const gstRate = Number(opt.gst || 0);
        const gstAmount = Math.round(price * gstRate);
        const total = price + gstAmount;
        const selected = String(value) === String(opt.value);
        return (
          <div key={opt.value} className={`rounded-xl shadow-lg border w-80 px-6 py-6 flex flex-col items-center transition-transform ${selected ? "ring-2 ring-[#196e87] scale-105" : ""}`}>
            <div className="text-lg font-semibold mb-1">{opt.label}</div>
            <div className="text-2xl font-extrabold mb-2">
              {formatCurrency(price)}
              {gstRate ? <span className="text-sm font-normal ml-2">+ {formatCurrency(gstAmount)} GST</span> : <span className="text-sm font-normal ml-2">No GST</span>}
            </div>

            <ul className="mb-4 text-gray-700 text-sm list-disc pl-5 self-start">
              {Array.isArray(opt.features) && opt.features.map((f, i) => <li key={i}>{f}</li>)}
            </ul>

            <div className="w-full flex items-center justify-between">
              <div className="text-sm text-gray-600">Total:</div>
              <div className="text-lg font-bold">{formatCurrency(total)}</div>
            </div>

            <button
              className={`mt-4 px-5 py-2 rounded-full font-bold ${selected ? "bg-[#196e87] text-white" : "bg-gray-100 text-[#196e87]"}`}
              onClick={() => handleSelect(opt)}
            >
              {opt.button || (selected ? "Selected" : "Select")}
            </button>
          </div>
        );
      })}
    </div>
  );
}