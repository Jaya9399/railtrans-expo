import React from "react";

export default function Topbar() {
  return (
    <header className="w-full shadow flex items-center px-8 py-4" style={{ backgroundColor: "#196e87" }}>
      <img
        src="/images/logo.png"
        alt="RailTrans Logo"
        className="h-12 w-auto mr-4"
        style={{ objectFit: "contain" }}
      />
    </header>
  );
}