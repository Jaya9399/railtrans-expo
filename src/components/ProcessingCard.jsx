import React from "react";

/**
 * ProcessingCard
 *
 * Shows a centered white "card" with a spinner and messages.
 * Use it wherever you need a friendly "processing — don't close this page" UI.
 *
 * Props:
 * - title: main heading (string)
 * - message: primary instruction text (string)
 * - note: smaller secondary note (string)
 */
export default function ProcessingCard({
  title = "Finalizing your registration…",
  message = "Please don't close this page. We're completing your registration and sending your ticket. This may take up to a minute.",
  note = "If you have completed payment in another tab, please wait while we confirm it.",
}) {
  return (
    <div className="flex items-center justify-center py-8">
      <div className="w-full max-w-xl bg-white rounded-xl shadow-lg border border-gray-100 p-6">
        <div className="flex items-start gap-4">
          <div className="flex items-center justify-center w-14 h-14 rounded-full bg-gray-50 border border-gray-200">
            <svg className="w-8 h-8 animate-spin text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle className="opacity-25" cx="12" cy="12" r="10" strokeWidth="4"></circle>
              <path className="opacity-75" d="M4 12a8 8 0 018-8" strokeWidth="4" strokeLinecap="round"></path>
            </svg>
          </div>

          <div className="flex-1">
            <div className="text-lg font-semibold text-gray-800">{title}</div>
            <div className="mt-2 text-sm text-gray-600">
              {message}
            </div>
            {note ? <div className="mt-3 text-xs text-gray-500">{note}</div> : null}
          </div>
        </div>

        <div className="mt-6 text-right">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-gray-50 border border-gray-100 text-xs text-gray-500">
            Processing… please wait
          </div>
        </div>
      </div>
    </div>
  );
}