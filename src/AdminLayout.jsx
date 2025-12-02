import React from "react";
import Sidebar from "./components/Sidebar";
import Topbar from "./components/Topbar";

/**
 * AdminLayout (fixed topbar, left sidebar, full-width content)
 *
 * Problem you saw:
 * - Content was visually shifted to the right because the layout used a centered container (max-w-7xl mx-auto)
 *   and/or the Sidebar/topbar sizing caused extra left space.
 *
 * Fix applied:
 * - Topbar is fixed to top and full width.
 * - The content area below the topbar is a full-width flex row with a left sidebar (w-64) and a main area (flex-1).
 * - No centered max-width wrapper is used around the whole layout so the main content doesn't appear pushed to the right.
 *
 * If you prefer the inside content centered, you can keep a centered container inside <main> rather than around the whole layout.
 *
 * Make sure Topbar height matches TOPBAR_HEIGHT (default 64).
 */
const TOPBAR_HEIGHT = 64;

export default function AdminLayout({ children }) {
  return (
    <div className="min-h-screen bg-gray-50">
      {/* Fixed Topbar across full width */}
      <div className="fixed inset-x-0 top-0 z-40">
        <Topbar />
      </div>

      {/* Page content below topbar */}
      <div style={{ paddingTop: TOPBAR_HEIGHT }} className="w-full">
        <div className="flex w-full">
          {/* Sidebar column (left) */}
          <aside className="w-64 flex-shrink-0 border-r bg-white">
            <Sidebar />
          </aside>

          {/* Main content column (right) */}
          <main className="flex-1">
            {/* optional inner container to center content if desired:
                <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8"> ... </div>
                Put children inside the inner container.
            */}
            <div className="p-6">
              {children}
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}