import React, { useState, useEffect } from "react";
import Sidebar from "../components/Sidebar";
import Topbar from "../components/Topbar";
import VisitorsAdmin from "./VisitorsAdmin";
import ExhibitorsAdmin from "./ExhibitorsAdmin";
import PartnersAdmin from "./PartnersAdmin";
import SpeakersAdmin from "./SpeakersAdmin";
import AwardeesAdmin from "./AwardeesAdmin";
import DashboardContent from "./DashboardContent";
import Footer from "../components/Footer";

const TOPBAR_HEIGHT = 64;

export default function AdminPanel() {
  const [selected, setSelected] = useState("Dashboard");
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const user = { name: "Admin" };

  // Close sidebar on desktop resize
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    function onChange(e) {
      if (e.matches) setSidebarOpen(false);
    }
    if (m.matches) setSidebarOpen(false);
    m.addEventListener?.("change", onChange) || m.addListener?.(onChange);
    return () => {
      m.removeEventListener?.("change", onChange) || m.removeListener?.(onChange);
    };
  }, []);

  // Prevent body scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev || ""; };
    }
    return undefined;
  }, [sidebarOpen]);

  const renderPage = () => {
    switch (selected) {
      case "Dashboard": return <DashboardContent />;
      case "Visitors": return <VisitorsAdmin />;
      case "Exhibitors": return <ExhibitorsAdmin />;
      case "Partners": return <PartnersAdmin />;
      case "Speakers": return <SpeakersAdmin />;
      case "Awardees": return <AwardeesAdmin />;
      default:
        return (
          <div className="p-8">
            <h2 className="text-xl font-bold text-indigo-700 mb-4">{selected}</h2>
            <div className="bg-white p-6 rounded-xl shadow border">
              Coming Soon: {selected}
            </div>
          </div>
        );
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen w-full flex">
      {/* Sidebar - desktop fixed, mobile overlay */}
      <Sidebar 
        open={sidebarOpen} 
        onClose={() => setSidebarOpen(false)} 
        selected={selected} 
        onSelect={(page) => {
          setSelected(page);
          setSidebarOpen(false); // Close on mobile after selecting
        }} 
      />

      {/* Main area */}
      <div className="flex-1 flex flex-col md:ml-64 min-h-screen">
        {/* Fixed Topbar */}
        <div className="fixed top-0 right-0 left-0 md:left-64 z-40" style={{ height: TOPBAR_HEIGHT }}>
          <Topbar 
            showHamburger={true} 
            onToggleSidebar={() => setSidebarOpen(s => !s)} 
          />
        </div>

        {/* Content with padding for fixed topbar */}
        <main className="flex-1 pt-16 px-4 md:px-6">
          {renderPage()}
        </main>

        {/* Footer at bottom */}
        <Footer primaryColor="#196e87" />
      </div>
    </div>
  );
}