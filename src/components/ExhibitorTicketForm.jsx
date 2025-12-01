import React, { useState } from "react";
import TicketCategorySelector from "../components/TicketCategorySelector";

/**
 * Example Exhibitor form that uses the selector.
 * Adapt to your existing Exhibitors page: integrate state and payload keys the backend expects (companyName, category, spaceType, etc.)
 */
export default function ExhibitorTicketForm() {
  const [selected, setSelected] = useState("premium");
  const [meta, setMeta] = useState({ price: 5000, gstAmount: 900, total: 5900, label: "Premium" });
  const [form, setForm] = useState({ name: "", companyName: "", email: "", mobile: "" });
  const [msg, setMsg] = useState("");

  const onCategoryChange = (value, m) => { setSelected(value); setMeta(m); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setMsg("");
    const payload = {
      ...form,
      companyName: form.companyName,
      category: selected,
      price: meta.price,
      gst: meta.gstAmount,
      total: meta.total
    };
    try {
      const res = await fetch("/api/exhibitors", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      const j = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
      setMsg("Exhibitor registered");
      setForm({ name: "", companyName: "", email: "", mobile: "" });
    } catch (err) {
      console.error(err);
      setMsg("Failed: " + (err.message || err));
    }
  };

  return (
    <div className="max-w-3xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Exhibitor Registration</h2>

      <TicketCategorySelector role="exhibitors" value={selected} onChange={onCategoryChange} />

      <form onSubmit={handleSubmit} className="mt-6 space-y-3">
        <div><label className="block">Company Name</label><input value={form.companyName} onChange={e=>setForm(f=>({...f, companyName:e.target.value}))} className="w-full border rounded px-3 py-2" /></div>
        <div><label className="block">Contact Name</label><input value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} className="w-full border rounded px-3 py-2" /></div>
        <div className="flex gap-3">
          <div className="flex-1"><label className="block">Email</label><input value={form.email} onChange={e=>setForm(f=>({...f, email:e.target.value}))} className="w-full border rounded px-3 py-2" /></div>
          <div className="w-40"><label className="block">Mobile</label><input value={form.mobile} onChange={e=>setForm(f=>({...f, mobile:e.target.value}))} className="w-full border rounded px-3 py-2" /></div>
        </div>

        <div className="flex items-center justify-between mt-4">
          <div>Selected: <strong>{meta.label}</strong> — Total: <strong>₹{meta.total}</strong></div>
          <button className="px-4 py-2 bg-[#196e87] text-white rounded">Submit</button>
        </div>

        {msg && <div className="mt-2 text-sm text-red-600">{msg}</div>}
      </form>
    </div>
  );
}