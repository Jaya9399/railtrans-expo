import React, { useEffect } from "react";

/**
 * DeleteModal
 * Props:
 * - open: boolean
 * - onClose: () => void
 * - onConfirm: () => void
 * - title?: string
 * - message?: string
 * - confirmLabel?: string
 * - cancelLabel?: string
 *
 * Usage:
 * <DeleteModal open={deleteOpen} onClose={...} onConfirm={...} />
 */
export default function DeleteModal({
  open,
  onClose,
  onConfirm,
  title = "Delete Record",
  message = "Are you sure you want to delete this record? This action cannot be undone.",
  confirmLabel = "Delete",
  cancelLabel = "Cancel",
}) {
  useEffect(() => {
    function onKey(e) {
      if (e.key === "Escape") onClose && onClose();
    }
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* backdrop */}
      <div
        className="absolute inset-0 bg-black bg-opacity-40"
        onClick={() => onClose && onClose()}
      />

      {/* dialog */}
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="delete-modal-title"
        className="relative bg-white rounded-lg shadow-xl w-full max-w-md mx-4"
      >
        <div className="px-6 py-5">
          <h3 id="delete-modal-title" className="text-lg font-bold text-gray-900">
            {title}
          </h3>
          <p className="mt-2 text-sm text-gray-600">{message}</p>
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t">
          <button
            onClick={() => onClose && onClose()}
            className="px-4 py-2 rounded bg-gray-100 hover:bg-gray-200 text-gray-700"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => {
              onConfirm && onConfirm();
            }}
            className="px-4 py-2 rounded bg-red-600 hover:bg-red-700 text-white"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}