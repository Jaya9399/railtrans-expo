import React from "react";

/**
 * TicketCategorySelector
 *
 * Props:
 * - role: "visitors" | "exhibitors" | "partners" | "speakers" | "awardees" (optional)
 * - value: current selected value
 * - onChange(value, meta) : called when a category is selected. meta contains { price, gst, total, label }
 * - categories: optional override array of category objects (see default format)
 *
 * Category object shape:
 * {
 *   value: "free" | "premium" | "combo" | ...,
 *   label: "Free Ticket",
 *   price: 0,            // base price (number)
 *   gst: 0.18,           // GST fraction (0.18) or 0
 *   features: [ "..." ],
 *   button: "Get Free Ticket"
 * }
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

function formatCurrency(n) {
  if (typeof n !== "number") n = Number(n) || 0;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function TicketCategorySelector({ role = "visitors", value, onChange = () => {}, categories }) {
  const opts = Array.isArray(categories) ? categories : (DEFAULT_CATEGORIES_BY_ROLE[role] || DEFAULT_CATEGORIES_BY_ROLE.visitors);

  const handleSelect = (opt) => {
    const price = Number(opt.price || 0);
    const gstRate = Number(opt.gst || 0);
    const gstAmount = Math.round(price * gstRate);
    const total = price + gstAmount;
    onChange(opt.value, { price, gstRate, gstAmount, total, label: opt.label });
  };

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