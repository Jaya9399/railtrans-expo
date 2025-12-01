import React, { useState } from "react";
import TicketCategorySelector from "../components/TicketCategorySelector";

/**
 * Example integration for Visitor registration page.
 * - Shows TicketCategorySelector and uses selection in submit payload.
 * - Replace form submit URL / behavior to fit your app.
 */
export default function VisitorsTicketForm() {
  const [selected, setSelected] = useState("free");
  const [ticketMeta, setTicketMeta] = useState({ price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "Free" });
  const [form, setForm] = useState({ name: "", email: "", mobile: "" });
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState("");

  const onCategoryChange = (value, meta) => {
    setSelected(value);
    setTicketMeta(meta || { price: 0, gstRate: 0, gstAmount: 0, total: 0, label: "" });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    setLoading(true);
    try {
      const payload = {
        ...form,
        ticket_category: selected,
        ticket_price: ticketMeta.price,
        ticket_gst: ticketMeta.gstAmount,
        ticket_total: ticketMeta.total
      };
      console.debug("Submitting visitor payload:", payload);
      const res = await fetch("/api/visitors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const j = await res.json().catch(() => null);
      if (!res.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
      setMsg("Registration successful");
      setForm({ name: "", email: "", mobile: "" });
    } catch (err) {
      console.error(err);
      setMsg("Submit failed: " + (err.message || err));
    } finally { setLoading(false); }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Visitor Registration</h2>

      <TicketCategorySelector role="visitors" value={selected} onChange={onCategoryChange} />

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <div>
          <label className="block text-sm font-medium">Name</label>
          <input value={form.name} onChange={e => setForm(f => ({...f, name: e.target.value}))} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium">Email</label>
          <input value={form.email} onChange={e => setForm(f => ({...f, email: e.target.value}))} className="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label className="block text-sm font-medium">Mobile</label>
          <input value={form.mobile} onChange={e => setForm(f => ({...f, mobile: e.target.value}))} className="w-full border rounded px-3 py-2" />
        </div>

        <div className="flex items-center justify-between mt-4">
          <div className="text-sm">Selected: <strong>{ticketMeta.label}</strong> — Total: <strong>₹{ticketMeta.total}</strong></div>
          <button disabled={loading} className="px-4 py-2 bg-[#196e87] text-white rounded">{loading ? "Submitting..." : "Register"}</button>
        </div>

        {msg && <div className="text-sm mt-2 text-red-600">{msg}</div>}
      </form>
    </div>
  );
}