import React from "react";

export default function ThankYouMessage({ email }) {
  return (
    <div className="mx-auto w-full max-w-2xl bg-white rounded-2xl shadow-2xl border border-[#bde0fe] p-8 flex flex-col items-center">
      <div className="text-2xl font-extrabold mb-4 text-[#21809b]">Thank You for Registering!</div>
      <div className="text-lg mb-2 text-[#196e87]">Your registration has been received.</div>
      <div className="text-base mb-1">
        Please check your email{email ? ` (${email})` : ""} for acknowledgement.
      </div>
      <div className="mt-3 text-[#21809b] text-base">
        For any queries, contact support@railtransexpo.com.
      </div>
    </div>
  );
}