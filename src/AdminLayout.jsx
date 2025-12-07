import React, { useState } from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

/**
 * AdminLayout
 * - Topbar is fixed at the top (height TOPBAR_HEIGHT)
 * - Sidebar is fixed on the left (width SIDEBAR_WIDTH) on md+ and overlay on mobile
 * - Main content area is offset (paddingTop + md padding-left) so it never sits underneath topbar/sidebar
 *
 * Usage: Wrap admin pages with <AdminLayout>{children}</AdminLayout>
 */
const TOPBAR_HEIGHT = 64;
const SIDEBAR_WIDTH = 256; // matches w-64 (64 * 4 = 256px)

export default function AdminLayout({ children }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen flex bg-gray-50">
      {/* Sidebar (fixed): pass open & onClose so mobile drawer works */}
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      {/* Fixed Topbar area (AdminLayout reserves the top area) */}
      <div
        className="fixed inset-x-0 top-0 z-50"
        style={{ height: TOPBAR_HEIGHT, minHeight: TOPBAR_HEIGHT }}
      >
        <Topbar onToggleSidebar={() => setSidebarOpen(s => !s)} />
      </div>

      {/* Main content: push down by topbar height, and on md+ offset left for sidebar width */}
      <div
        className="flex-1"
        style={{
          minHeight: "100vh",
          paddingTop: TOPBAR_HEIGHT, // push content below the fixed topbar
        }}
      >
        {/* On md+ screens shift content right so it doesn't sit under the fixed sidebar */}
        <div style={{ paddingLeft: 0 }} className="md:pl-64">
          <div className="max-w-full md:max-w-screen-xl xl:max-w-screen-2xl mx-auto px-4 md:px-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}