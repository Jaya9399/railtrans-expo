import React, { useState } from "react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import VisitorsAdmin from "./VisitorsAdmin";
import ExhibitorsAdmin from "./ExhibitorsAdmin";
import PartnersAdmin from "./PartnersAdmin";
import SpeakersAdmin from "./SpeakersAdmin";
import AwardeesAdmin from "./AwardeesAdmin";

// Dummy Dashboard content (unchanged, you can customize more)
function DashboardContent() {
  return (
    <div className="p-8">
      <div className="text-2xl font-bold mb-4">Welcome to Admin Dashboard</div>
      <div className="text-gray-600">Select a section from the sidebar to manage pages and registrations.</div>
    </div>
  );
}

export default function AdminPanel() {
  const [selected, setSelected] = useState("Dashboard");
  const user = { name: "Admin" };

  const renderPage = () => {
    switch (selected) {
      case "Dashboard":
        return <DashboardContent />;
      case "Visitors":
        return <VisitorsAdmin />;
      case "Exhibitors":
        return <ExhibitorsAdmin />;
      case "Partners":
        return <PartnersAdmin />;
      case "Speakers":
        return <SpeakersAdmin />;
      case "Awardees":
        return <AwardeesAdmin />;
      default:
        return (
          <div className="p-8">
            <h2 className="text-xl font-bold text-indigo-700 mb-4">{selected}</h2>
            <div className="bg-white p-6 rounded-xl shadow border">Coming Soon: {selected}</div>
          </div>
        );
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen w-full">
      <Topbar user={user} />
      <Sidebar selected={selected} onSelect={setSelected} />
      <div className="flex-1 flex flex-col ml-64">
        <main className="flex-1 overflow-y-auto">{renderPage()}</main>
      </div>
    </div>
  );
}