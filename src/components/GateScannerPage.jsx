import React from "react";
import Topbar from "./Topbar";
import TicketScanner from "./TicketScanner";

export default function GateScannerPage() {
  function handleError(err) {
    console.error("Scanner error:", err);
    alert(err.message || "Scanner error");
  }
  function handleSuccess(result) {
    console.log("Scan success:", result);
    // You can show a success toast or UI if desired
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-[#196e87] mb-4">Gate Scanner</h2>
        <div className="bg-white rounded-lg shadow p-4">
          <TicketScanner onError={handleError} onSuccess={handleSuccess} apiPath="/api/tickets/scan" />
        </div>
      </div>
    </div>
  );
}