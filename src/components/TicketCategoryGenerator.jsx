import React, { useEffect, useState } from "react";

/**
 * TicketCategorySelector (manager-backed, responsive)
 *
 * - Reads ticket category amounts from localStorage (key: "ticket_categories_local_v1")
 * - Falls back to built-in defaults
 * - Emits onChange(value, meta) where meta = { price, gstRate, gstAmount, total, label }
 *
 * Responsiveness:
 * - Cards are full-width on small screens and fixed width on >=sm
 * - Feature list collapses into a <details> on small screens to save vertical space
 * - Buttons are full-width on small screens
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
  // Intl currency formatting can vary - using rupee sign + localized number
  return `₹${num.toLocaleString("en-IN")}`;
}

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

function resolveCategories(role, overrideCategories) {
  if (Array.isArray(overrideCategories) && overrideCategories.length) {
    return normalizeCategoriesArray(overrideCategories, DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
  }
  const local = readCategoriesFromLocalStorage();
  if (local && local[role] && Array.isArray(local[role]) && local[role].length) {
    return normalizeCategoriesArray(local[role], DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
  }
  return normalizeCategoriesArray(DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors, DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);
}

function findCategoryByValue(value, categories) {
  if (!value) return null;
  const v = String(value).toLowerCase();
  return (categories || []).find(c => String(c.value).toLowerCase() === v) || null;
}

function fallbackCategoryMeta(value, role) {
  if (!value) return { price: 0, gst: 0, label: value || "" };
  const v = String(value).toLowerCase();
  if (v.includes("combo")) return { price: 5000, gst: 0.18, label: "Combo" };
  if (v.includes("premium")) {
    if (role === "partners") return { price: 15000, gst: 0.18, label: "Premium" };
    if (role === "exhibitors") return { price: 5000, gst: 0.18, label: "Premium" };
    return { price: 2500, gst: 0.18, label: "Premium" };
  }
  if (v.includes("free") || v.includes("general") || v === "0") return { price: 0, gst: 0, label: "Free" };
  if (v.includes("vip")) return { price: 7500, gst: 0.18, label: "VIP" };
  return { price: 2500, gst: 0.18, label: String(value) };
}

export default function TicketCategorySelector({ role = "visitors", value, onChange = () => {}, categories: categoriesProp }) {
  const [opts, setOpts] = useState(() => resolveCategories(role, categoriesProp));
  useEffect(() => { setOpts(resolveCategories(role, categoriesProp)); }, [role, categoriesProp]);

  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === LOCAL_STORAGE_KEY) {
        setOpts(resolveCategories(role, categoriesProp));
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [role, categoriesProp]);

  const handleSelect = (opt) => {
    const allOpts = resolveCategories(role, categoriesProp);
    const matched = findCategoryByValue(opt.value, allOpts) || null;
    let price, gstRate, gstAmount, total, label;
    if (matched) {
      price = safeNumber(matched.price);
      gstRate = safeNumber(matched.gst);
      gstAmount = Math.round(price * gstRate);
      total = price + gstAmount;
      label = matched.label || opt.label || String(opt.value);
    } else {
      const fb = fallbackCategoryMeta(opt.value, role);
      price = safeNumber(fb.price);
      gstRate = safeNumber(fb.gst);
      gstAmount = Math.round(price * gstRate);
      total = price + gstAmount;
      label = fb.label || opt.label || String(opt.value);
    }
    onChange(opt.value, { price, gstRate, gstAmount, total, label });
  };

  // Render responsive cards: full width on small screens, fixed width on >=sm
  return (
    <div className="bg-white py-6 px-4">
      <div className="max-w-7xl mx-auto">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {opts.map(opt => {
            const price = Number(opt.price || 0);
            const gstRate = Number(opt.gst || 0);
            const gstAmount = Math.round(price * gstRate);
            const total = price + gstAmount;
            const selected = String(value) === String(opt.value);
            return (
              <div
                key={opt.value}
                className={`rounded-lg border p-4 flex flex-col justify-between transition-transform ${selected ? "ring-2 ring-[#196e87] scale-105" : "hover:shadow-md"}`}
                aria-pressed={selected}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") handleSelect(opt); }}
              >
                <div>
                  <div className="text-lg font-semibold mb-1">{opt.label}</div>
                  <div className="text-2xl font-extrabold mb-2">
                    {formatCurrency(price)}
                    {gstRate ? <span className="text-sm font-normal ml-2">+ {formatCurrency(gstAmount)} GST</span> : <span className="text-sm font-normal ml-2">No GST</span>}
                  </div>

                  {/* Features: show inline on wide, collapse on small */}
                  <div className="mb-3">
                    <div className="hidden sm:block text-sm text-gray-700">
                      <ul className="list-disc pl-5">
                        {Array.isArray(opt.features) && opt.features.map((f, i) => <li key={i}>{f}</li>)}
                      </ul>
                    </div>
                    <div className="block sm:hidden">
                      <details className="text-sm text-gray-700">
                        <summary className="cursor-pointer">View features</summary>
                        <ul className="list-disc pl-5 mt-2">
                          {Array.isArray(opt.features) && opt.features.map((f, i) => <li key={i}>{f}</li>)}
                        </ul>
                      </details>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between">
                  <div>
                    <div className="text-sm text-gray-600">Total</div>
                    <div className="text-lg font-bold">{formatCurrency(total)}</div>
                  </div>
                  <button
                    className={`ml-4 py-2 px-4 rounded-full font-bold ${selected ? "bg-[#196e87] text-white" : "bg-gray-100 text-[#196e87]"} w-full sm:w-auto`}
                    onClick={() => handleSelect(opt)}
                    aria-pressed={selected}
                  >
                    {selected ? "Selected" : (opt.button || "Select")}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}