import React, { useEffect, useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

/**
 * AdminLayout
 * - Renders Desktop sidebar (hidden on small screens) and Mobile overlay (controlled by `sidebarOpen`).
 * - Topbar fixed at top. Topbar inner content uses md:ml-64 so it lines up with main content.
 * - Main content uses md:ml-64 and pt-16 to avoid overlap with sidebar/topbar.
 *
 * Use: wrap admin pages in this layout only once.
 */

const TOPBAR_HEIGHT = 64;

export default function AdminLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // prevent background scroll when mobile sidebar is open
  useEffect(() => {
    if (sidebarOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => { document.body.style.overflow = prev || ""; };
    }
    return undefined;
  }, [sidebarOpen]);

  // close sidebar when viewport becomes desktop
  useEffect(() => {
    const m = window.matchMedia("(min-width: 768px)");
    function onChange(e) {
      if (e.matches) setSidebarOpen(false);
    }
    if (m.matches) setSidebarOpen(false);
    m.addEventListener ? m.addEventListener("change", onChange) : m.addListener(onChange);
    return () => { m.removeEventListener ? m.removeEventListener("change", onChange) : m.removeListener(onChange); };
  }, []);

  return (
    <div className="min-h-screen flex bg-gray-50">
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Topbar fixed */}
      <div className="fixed inset-x-0 top-0 z-40" style={{ height: TOPBAR_HEIGHT }}>
        <Topbar onToggleSidebar={() => setSidebarOpen((s) => !s)} />
      </div>

      {/* Main content */}
      <main className="flex-1" style={{ minHeight: "100vh" }}>
        <div className="md:ml-64 pt-16">
          <div className="max-w-full md:max-w-screen-xl xl:max-w-screen-2xl mx-auto px-4 md:px-6">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}