import React, { useEffect, useState } from "react";

/*
 TicketPricingManager.jsx (client-side only)

 - Pure client-side editor for ticket categories and pricing.
 - Persists to browser localStorage only (no backend calls).
 - Supports add / remove category, edit label/price/gst/button text.
 - Export / Import JSON to move settings between environments.
 - Reset to built-in defaults.
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
  const num = Number(n) || 0;
  return `₹${num.toLocaleString("en-IN")}`;
}

function safeNumber(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

const LOCAL_STORAGE_KEY = "ticket_categories_local_v1";

export default function TicketPricingManager() {
  const [categoriesByRole, setCategoriesByRole] = useState(null);
  const [loading, setLoading] = useState(true);
  const [savingMessage, setSavingMessage] = useState("");
  const [error, setError] = useState("");

  // Load from localStorage or defaults
  useEffect(() => {
    setLoading(true);
    try {
      const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (raw) {
        try {
          const parsed = JSON.parse(raw);
          // basic validation: ensure keys exist
          const normalized = {};
          Object.keys(DEFAULT_CATEGORIES_BY_ROLE).forEach(role => {
            if (Array.isArray(parsed[role])) normalized[role] = parsed[role];
            else normalized[role] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE[role]));
          });
          setCategoriesByRole(normalized);
          setLoading(false);
          return;
        } catch (e) {
          // ignore parse error and fall back to defaults
        }
      }
      setCategoriesByRole(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE)));
    } catch (e) {
      setCategoriesByRole(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE)));
    } finally {
      setLoading(false);
    }
  }, []);

  const onUpdateCategory = (role, idx, changes) => {
    setCategoriesByRole(prev => {
      const copy = { ...(prev || {}) };
      copy[role] = (copy[role] || []).map((c, i) => i === idx ? { ...c, ...changes } : c);
      return copy;
    });
  };

  const onAddCategory = (role) => {
    setCategoriesByRole(prev => {
      const copy = { ...(prev || {}) };
      const arr = copy[role] ? [...copy[role]] : [];
      const next = { value: `custom-${Date.now()}`, label: "New Category", price: 0, gst: 0, features: [], button: "Select" };
      arr.push(next);
      copy[role] = arr;
      return copy;
    });
  };

  const onRemoveCategory = (role, idx) => {
    if (!window.confirm("Remove this category?")) return;
    setCategoriesByRole(prev => {
      const copy = { ...(prev || {}) };
      copy[role] = (copy[role] || []).filter((_, i) => i !== idx);
      return copy;
    });
  };

  // Save locally to localStorage
  const onSaveLocally = () => {
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(categoriesByRole || DEFAULT_CATEGORIES_BY_ROLE));
      setSavingMessage("Saved locally in your browser.");
      setTimeout(() => setSavingMessage(""), 3000);
    } catch (e) {
      console.error("local save failed", e);
      setError("Failed to save locally");
    }
  };

  const onResetDefaults = () => {
    if (!window.confirm("Reset to built-in defaults? This will overwrite unsaved changes.")) return;
    setCategoriesByRole(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE)));
  };

  const onExportJson = () => {
    const payload = JSON.stringify(categoriesByRole || DEFAULT_CATEGORIES_BY_ROLE, null, 2);
    const blob = new Blob([payload], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `ticket-categories-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setSavingMessage("Export started");
    setTimeout(() => setSavingMessage(""), 2000);
  };

  const onImportJson = (file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(String(e.target.result));
        const normalized = {};
        Object.keys(DEFAULT_CATEGORIES_BY_ROLE).forEach(r => {
          if (Array.isArray(data[r])) {
            normalized[r] = data[r].map((c,i) => ({
              value: c.value || c.key || `c${i}`,
              label: c.label || c.value || `Category ${i+1}`,
              price: safeNumber(c.price || c.amount || 0),
              gst: safeNumber(c.gst || c.tax || 0),
              features: Array.isArray(c.features) ? c.features : (c.features ? [String(c.features)] : []),
              button: c.button || "Select"
            }));
          } else {
            normalized[r] = JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE[r]));
          }
        });
        setCategoriesByRole(normalized);
        setSavingMessage("Imported JSON applied (unsaved).");
        setTimeout(()=>setSavingMessage(""),3000);
      } catch (err) {
        setError("Invalid JSON file");
        setTimeout(()=>setError(""),3000);
      }
    };
    reader.readAsText(file);
  };

  const clearLocal = () => {
    if (!window.confirm("Clear locally saved categories? This will remove the local copy and reload defaults.")) return;
    localStorage.removeItem(LOCAL_STORAGE_KEY);
    setCategoriesByRole(JSON.parse(JSON.stringify(DEFAULT_CATEGORIES_BY_ROLE)));
    setSavingMessage("Local copy cleared and defaults restored.");
    setTimeout(()=>setSavingMessage(""),3000);
  };

  if (loading || !categoriesByRole) {
    return <div className="p-6 text-gray-600">Loading ticket categories…</div>;
  }

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">Ticket Categories & Pricing (Local)</h1>
        <div className="flex items-center gap-2">
          <button onClick={onExportJson} className="px-3 py-1 border rounded">Export JSON</button>
          <label className="px-3 py-1 border rounded bg-white cursor-pointer">
            Import JSON
            <input type="file" accept="application/json" onChange={(e) => onImportJson(e.target.files && e.target.files[0])} style={{ display: "none" }} />
          </label>
          <button onClick={onResetDefaults} className="px-3 py-1 border rounded">Reset Defaults</button>
          <button onClick={onSaveLocally} className="px-4 py-2 bg-indigo-600 text-white rounded">Save locally</button>
          <button onClick={clearLocal} className="px-3 py-1 border rounded">Clear local</button>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-sm text-gray-600">This editor is client-side only. Changes are stored in your browser localStorage and will not be sent to any server.</div>
      </div>

      {savingMessage && <div className="mb-4 text-green-700">{savingMessage}</div>}
      {error && <div className="mb-4 text-red-600">{error}</div>}

      <div className="space-y-8">
        {Object.keys(categoriesByRole).map(role => (
          <section key={role}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold">{role.charAt(0).toUpperCase() + role.slice(1)}</h2>
              <button onClick={() => onAddCategory(role)} className="px-3 py-1 border rounded">Add Category</button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {(categoriesByRole[role] || []).map((cat, idx) => {
                const price = safeNumber(cat.price);
                const gst = safeNumber(cat.gst);
                const gstAmount = Math.round(price * gst);
                const total = price + gstAmount;
                return (
                  <div key={cat.value || `${role}-${idx}`} className="p-4 border rounded bg-white">
                    <div className="flex items-start justify-between gap-4">
                      <div className="flex-1">
                        <div className="mb-2">
                          <label className="block text-sm font-medium">Label</label>
                          <input value={cat.label} onChange={(e) => onUpdateCategory(role, idx, { label: e.target.value })} className="w-full border rounded px-2 py-1" />
                        </div>

                        <div className="mb-2 grid grid-cols-3 gap-2">
                          <div>
                            <label className="block text-sm font-medium">Price</label>
                            <input type="number" value={cat.price} onChange={(e) => onUpdateCategory(role, idx, { price: Number(e.target.value) })} className="w-full border rounded px-2 py-1" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium">GST (fraction)</label>
                            <input type="number" step="0.01" value={cat.gst} onChange={(e) => onUpdateCategory(role, idx, { gst: Number(e.target.value) })} className="w-full border rounded px-2 py-1" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium">Button text</label>
                            <input value={cat.button} onChange={(e) => onUpdateCategory(role, idx, { button: e.target.value })} className="w-full border rounded px-2 py-1" />
                          </div>
                        </div>

                        <div className="mb-2">
                          <label className="block text-sm font-medium">Features (comma separated)</label>
                          <input value={(cat.features || []).join(", ")} onChange={(e) => onUpdateCategory(role, idx, { features: e.target.value.split(",").map(s => s.trim()).filter(Boolean) })} className="w-full border rounded px-2 py-1" />
                        </div>

                        <div className="text-sm text-gray-600 mt-1">
                          GST amount: <strong>{formatCurrency(gstAmount)}</strong> — Total: <strong>{formatCurrency(total)}</strong>
                        </div>
                      </div>

                      <div className="flex flex-col items-end gap-2">
                        <button onClick={() => onRemoveCategory(role, idx)} className="px-3 py-1 bg-red-50 text-red-700 rounded">Remove</button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}