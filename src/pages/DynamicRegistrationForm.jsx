import React from "react";

export default function DynamicRegistrationForm({ config, form, setForm, onSubmit, editable = true }) {
  function handleChange(e) {
    const { name, value, type, checked } = e.target;
    setForm(f => ({ ...f, [name]: type === "checkbox" ? checked : value }));
  }

  const safeFields = (config.fields || []).filter(f => f.visible && f.name && f.label);

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(); }}
      className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8"
    >
      <div className="flex flex-col gap-7">
        {safeFields.length === 0 && (
          <div className="text-red-500 text-center">No fields configured for this form.</div>
        )}
        {safeFields.map(field => (
          <div key={field.name}>
            {/* Custom rendering for checkbox to match requested style */}
            {field.type === "checkbox" ? (
              <div className="flex items-center gap-2 mt-2">
                <input
                  type="checkbox"
                  name={field.name}
                  checked={!!form[field.name]}
                  onChange={handleChange}
                  disabled={!editable}
                  required={field.required}
                />
                <span className="text-lg text-gray-600">
                  {/* Custom label for Accept Terms checkbox */}
                  {field.name === "terms"
                    ? (
                      <>
                        I accept and agree to the{" "}
                        <a
                          href="https://www.railtransexpo.com/terms"
                          className="text-[#21809b] underline"
                          target="_blank"
                          rel="noopener noreferrer"
                        >
                          Terms of Use
                        </a>
                        .
                      </>
                    )
                    : field.label
                  }
                </span>
              </div>
            ) : (
              <>
                <label className="font-semibold text-[#21809b] text-lg">{field.label}</label>
                {field.type === "text" || field.type === "email" || field.type === "number" ? (
                  <input
                    type={field.type}
                    name={field.name}
                    value={form[field.name] || ""}
                    onChange={handleChange}
                    className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                    disabled={!editable}
                    required={field.required}
                  />
                ) : field.type === "textarea" ? (
                  <textarea
                    name={field.name}
                    value={form[field.name] || ""}
                    onChange={handleChange}
                    className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                    rows={3}
                    disabled={!editable}
                    required={field.required}
                  />
                ) : field.type === "select" ? (
                  <select
                    name={field.name}
                    value={form[field.name] || ""}
                    onChange={handleChange}
                    className="w-full mt-2 p-4 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-lg"
                    disabled={!editable}
                    required={field.required}
                  >
                    <option value="">Select {field.label}</option>
                    {(field.options || []).map(opt =>
                      <option key={opt} value={opt}>{opt}</option>
                    )}
                  </select>
                ) : field.type === "radio" ? (
                  <div className="flex gap-4 mt-2">
                    {(field.options || []).map(opt => (
                      <label key={opt} className="flex items-center gap-2">
                        <input
                          type="radio"
                          name={field.name}
                          value={opt}
                          checked={form[field.name] === opt}
                          onChange={handleChange}
                          disabled={!editable}
                          required={field.required}
                        />
                        {opt}
                      </label>
                    ))}
                  </div>
                ) : null}
              </>
            )}
          </div>
        ))}
        <div className="flex justify-end items-center mt-8">
          <button
            type="submit"
            className="px-8 py-3 rounded-xl bg-[#21809b] text-white font-semibold text-lg"
            disabled={!editable || safeFields.length === 0}
          >
            Submit
          </button>
        </div>
      </div>
    </form>
  );
}