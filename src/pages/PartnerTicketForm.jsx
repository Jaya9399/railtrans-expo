import React, { useState } from "react";
import TicketCategorySelector from "../components/TicketCategorySelector";

export default function PartnerTicketForm() {
  const [selected, setSelected] = useState("premium");
  const [meta, setMeta] = useState({ price: 15000, gstAmount: Math.round(15000*0.18), total: Math.round(15000*1.18), label: "Premium" });
  const [form, setForm] = useState({ name:"", company:"", mobile:"", email:"" });
  const [msg, setMsg] = useState("");

  const onCategoryChange = (val, m) => { setSelected(val); setMeta(m); };

  const submit = async (e) => {
    e.preventDefault();
    setMsg("");
    const payload = { ...form, partnership: selected, price: meta.price, gst: meta.gstAmount, total: meta.total };
    try {
      const res = await fetch("/api/partners", { method: "POST", headers: {"Content-Type":"application/json"}, body: JSON.stringify(payload) });
      const j = await res.json().catch(()=>null);
      if (!res.ok) throw new Error((j && (j.error || j.message)) || `HTTP ${res.status}`);
      setMsg("Partner registered");
      setForm({ name:"", company:"", mobile:"", email:"" });
    } catch (err) {
      console.error(err);
      setMsg("Failed: " + (err.message || err));
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded shadow">
      <h2 className="text-2xl font-bold mb-4">Partner Registration</h2>
      <TicketCategorySelector role="partners" value={selected} onChange={onCategoryChange} />

      <form onSubmit={submit} className="mt-6 space-y-3">
        <div><label>Company</label><input className="w-full border rounded px-3 py-2" value={form.company} onChange={e=>setForm(f=>({...f, company:e.target.value}))} /></div>
        <div className="flex gap-3"><div className="flex-1"><label>Name</label><input className="w-full border rounded px-3 py-2" value={form.name} onChange={e=>setForm(f=>({...f, name:e.target.value}))} /></div><div className="w-40"><label>Mobile</label><input className="w-full border rounded px-3 py-2" value={form.mobile} onChange={e=>setForm(f=>({...f, mobile:e.target.value}))} /></div></div>
        <div><label>Email</label><input className="w-full border rounded px-3 py-2" value={form.email} onChange={e=>setForm(f=>({...f, email:e.target.value}))} /></div>

        <div className="flex items-center justify-between mt-4">
          <div>Selected: <strong>{meta.label}</strong> — Total: <strong>₹{meta.total}</strong></div>
          <button className="px-4 py-2 bg-[#196e87] text-white rounded">Register Partner</button>
        </div>
        {msg && <div className="mt-2 text-sm text-red-600">{msg}</div>}
      </form>
    </div>
  );
}