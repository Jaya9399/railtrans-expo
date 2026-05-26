import React from "react";
import Topbar from "./Topbar";
import TicketScanner from "./TicketScanner";
import Footer from "./Footer";
export default function GateScannerPage() {
  return (
    <div className="min-h-screen bg-gray-50">
      <Topbar />
      <div className="max-w-4xl mx-auto p-6">
        <h2 className="text-2xl font-bold text-[#196e87] mb-4">Gate Scanner</h2>
        <div className="bg-white rounded-lg shadow p-4">
          <TicketScanner
            mode="sticker"
            autoPrintOnValidate={true}  
            showDebug={false}
            stickerPageSize={{ w: "80mm", h: "50mm" }}
            onError={(err) => console.error("Error:", err)}
            onSuccess={(result) => console.log("Success:", result)}
          />
        </div>
      </div>
      <Footer primaryColor="#196e87" />   
    </div>
  );
}