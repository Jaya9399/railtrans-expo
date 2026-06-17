import React, { useEffect, useState } from "react";

const DEFAULT_CATEGORIES_BY_ROLE = {
  visitors: [
    { 
      value: "free", 
      label: "Free", 
      price: 0, 
      gst: 0, 
      features: ["Entry to Expo", "Access to General Sessions"], 
      button: "Get Free Ticket" 
    },
    { 
      value: "premium", 
      label: "Premium", 
      price: 6000, // Base price after 40% discount
      gst: 1080, // 18% GST of 6000 = 1080
      features: [
        "Priority Access", 
        "Premium Lounge", 
        "E-Ticket with QR",
        "Networking Opportunities",
        "Event Kit"
      ], 
      button: "Book Now",
      originalPrice: 10000, // Original price before 40% discount
      discount: 40, // 40% OFF
      finalPrice: 7080 // Total = 6000 + 1080 GST
    },
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
    button: (c && c.button) ? String(c.button) : "Select",
    originalPrice: safeNumber(c && c.originalPrice ? c.originalPrice : 0),
    discount: safeNumber(c && c.discount ? c.discount : 0),
    finalPrice: safeNumber(c && c.finalPrice ? c.finalPrice : 0),
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

export default function TicketCategorySelector({ role = "visitors", value, onChange = () => {}, categories: categoriesProp }) {
  const [opts, setOpts] = useState(() => resolveCategories(role, categoriesProp));
  
  useEffect(() => { 
    setOpts(resolveCategories(role, categoriesProp)); 
  }, [role, categoriesProp]);

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
    let price, gstAmount, total, label;
    
    if (matched) {
      price = safeNumber(matched.price);
      gstAmount = safeNumber(matched.gst);
      total = price + gstAmount;
      label = matched.label || opt.label || String(opt.value);
    } else {
      price = safeNumber(opt.price);
      gstAmount = safeNumber(opt.gst);
      total = price + gstAmount;
      label = opt.label || String(opt.value);
    }
    
    onChange(opt.value, { price, gstAmount, total, label });
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {opts.map(opt => {
          const price = Number(opt.price || 0);
          const gstAmount = Number(opt.gst || 0);
          const total = Number(opt.finalPrice || (price + gstAmount));
          const selected = String(value) === String(opt.value);
          const isFree = price === 0;
          const hasDiscount = opt.originalPrice > 0 && opt.discount > 0;
          
          return (
            <div
              key={opt.value}
              onClick={() => handleSelect(opt)}
              className={`
                relative cursor-pointer rounded-xl border-2 transition-all duration-200 overflow-hidden
                ${selected 
                  ? 'border-blue-500 bg-blue-50 ring-2 ring-blue-200 ring-offset-0' 
                  : 'border-gray-200 hover:border-blue-300 hover:shadow-md bg-white'
                }
              `}
            >
              {/* Selection indicator */}
              {selected && (
                <div className="absolute top-3 right-3">
                  <svg className="w-5 h-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                  </svg>
                </div>
              )}
              
              <div className="p-5">
                {/* Ticket Label */}
                <div className="mb-3">
                  <h3 className={`text-xl font-bold ${selected ? 'text-blue-600' : 'text-gray-800'}`}>
                    {opt.label}
                  </h3>
                </div>
                
                {/* Pricing */}
                <div className="mb-4">
                  {isFree ? (
                    <div className="inline-block px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                      FREE
                    </div>
                  ) : (
                    <>
                      {/* Original Price with strike-through */}
                      {hasDiscount && (
                        <div className="text-sm text-gray-400 line-through">
                          {formatCurrency(opt.originalPrice)}
                        </div>
                      )}
                      <div className="text-3xl font-bold text-gray-900">
                        {formatCurrency(price)}
                      </div>
                      {hasDiscount && (
                        <div className="inline-block px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-semibold mt-1">
                          {opt.discount}% OFF
                        </div>
                      )}
                      {gstAmount > 0 && (
                        <div className="text-sm text-gray-500 mt-1">
                          + {formatCurrency(gstAmount)} GST (18%)
                        </div>
                      )}
                      {hasDiscount && (
                        <div className="text-xs text-gray-400 mt-2">
                          Standard price ₹{formatCurrency(opt.originalPrice)} per head with 40% OFF
                        </div>
                      )}
                    </>
                  )}
                </div>
                
                {/* Features List */}
                <div className="mb-5">
                  <ul className="space-y-2">
                    {Array.isArray(opt.features) && opt.features.map((f, i) => (
                      <li key={i} className="flex items-start text-sm text-gray-600">
                        <svg className="w-4 h-4 text-green-500 mr-2 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                
                {/* Total and Button */}
                <div className="pt-3 border-t border-gray-100">
                  {!isFree && (
                    <div className="flex justify-between items-center mb-3">
                      <span className="text-sm text-gray-500">Total Amount</span>
                      <span className="text-lg font-bold text-gray-900">{formatCurrency(total)}</span>
                    </div>
                  )}
                  
                  <button
                    className={`
                      w-full py-2.5 px-4 rounded-lg font-medium transition-all duration-200
                      ${selected 
                        ? 'bg-blue-600 text-white cursor-default' 
                        : isFree
                          ? 'bg-green-600 hover:bg-green-700 text-white'
                          : 'bg-gradient-to-r from-blue-600 to-blue-700 hover:from-blue-700 hover:to-blue-800 text-white'
                      }
                    `}
                    disabled={selected}
                  >
                    {selected ? '✓ Selected' : (opt.button || 'Select')}
                  </button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}