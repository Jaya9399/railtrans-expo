import React from "react";
import { NavLink, useNavigate } from "react-router-dom";
import {
  HiOutlineViewGrid,
  HiOutlineUserGroup,
  HiOutlineBriefcase,
  HiOutlineSpeakerphone,
  HiOutlineHand,
  HiOutlineUserCircle,
  HiOutlineTable,
  HiOutlineLockClosed,
  HiOutlineChevronRight,
} from "react-icons/hi";

/**
 * Robust responsive Sidebar
 * - Desktop: fixed left column (hidden on small screens)
 * - Mobile: overlay drawer that is only rendered when `open` is true
 * This approach guarantees the sidebar is NOT present on phones unless opened via the hamburger.
 *
 * Props:
 *  - open: boolean (mobile overlay visibility)
 *  - onClose: function to close the overlay
 */
export default function Sidebar({ open = false, onClose = () => {} }) {
  const navigate = useNavigate();

  const items = [
    { label: "Overview", icon: HiOutlineViewGrid, path: "/admin" },
    { label: "Visitors", icon: HiOutlineUserGroup, path: "/VisitorsAdmin" },
    { label: "Exhibitors", icon: HiOutlineBriefcase, path: "/ExhibitorsAdmin" },
    { label: "Partners", icon: HiOutlineHand, path: "/PartnersAdmin" },
    { label: "Speakers", icon: HiOutlineSpeakerphone, path: "/SpeakersAdmin" },
    { label: "Awardees", icon: HiOutlineUserCircle, path: "/AwardeesAdmin" },
    { label: "Topbar-setting", icon: HiOutlineUserCircle, path: "/admin/topbar-settings" },
    { label: "Event details", icon: HiOutlineTable, path: "/event-details-admin" },
    { label: "Ticket Categories", icon: HiOutlineTable, path: "/payments-summary" },
  ];

  const doLogout = React.useCallback(() => {
    try {
      localStorage.removeItem("authToken");
      localStorage.removeItem("user");
      sessionStorage.removeItem("authToken");
      sessionStorage.removeItem("user");
      document.cookie.split(";").forEach((c) => {
        const name = c.split("=")[0].trim();
        if (!name) return;
        if (["token", "authToken", "session"].includes(name)) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
        }
      });
    } catch (e) {
      console.warn("logout cleanup", e);
    }
    try { onClose(); } catch {}
    navigate("/", { replace: true });
  }, [navigate, onClose]);

  function NavList({ onItemClick }) {
    return (
      <div className="px-2 py-4">
        <div className="px-3 text-xs uppercase text-gray-400 font-semibold mb-2">Management</div>

        <div className="space-y-1">
          {items.map((it) => {
            const Icon = it.icon;
            return (
              <NavLink
                key={it.path}
                to={it.path}
                onClick={() => { try { onItemClick(); } catch {} }}
                className={({ isActive }) =>
                  `group flex items-center gap-3 px-4 py-2 rounded-md mx-2 ${isActive ? "bg-slate-800 text-white font-semibold" : "text-slate-300 hover:bg-slate-800"}`
                }
                end
              >
                <span className="w-8 h-8 flex items-center justify-center text-lg"><Icon /></span>
                <span className="flex-1 text-sm">{it.label}</span>
                <HiOutlineChevronRight className="text-slate-500 opacity-0 group-hover:opacity-100" />
              </NavLink>
            );
          })}
        </div>

        <div className="mt-6 px-3">
          <button onClick={doLogout} className="w-full flex items-center gap-3 px-3 py-2 rounded-md text-red-400 hover:bg-red-600/5">
            <HiOutlineLockClosed className="text-lg" />
            <span className="text-sm">Logout</span>
          </button>
        </div>

        <div className="px-3 pt-4 text-xs text-slate-500">© {new Date().getFullYear()} RailTrans Expo</div>
      </div>
    );
  }

  // Desktop (fixed left) - hidden on small screens
  const Desktop = (
    <aside
      className="hidden md:block fixed top-0 left-0 z-40 h-full w-64 bg-[#0f1724] text-white"
      style={{ minHeight: "100vh" }}
      aria-label="Sidebar"
    >
      <div className="h-16 flex items-center px-4 border-b border-white/6">
        <div className="flex items-center gap-3">
          <div className="bg-gradient-to-br from-[#0ea5e9] to-[#196e87] p-2 rounded-lg shadow">
            <img src="/images/logo.png" alt="logo" className="h-6 w-auto" />
          </div>
          <div>
            <div className="text-lg font-bold">EventHub</div>
            <div className="text-xs text-slate-400">Admin</div>
          </div>
        </div>
      </div>
      <NavList onItemClick={() => {}} />
    </aside>
  );

  // Mobile overlay - only render when open === true
  const Mobile = open ? (
    <>
      <div
        className="fixed inset-0 z-40 md:hidden"
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className="fixed top-0 left-0 z-50 md:hidden h-full w-64 bg-[#0f1724] text-white shadow-lg"
        style={{ minHeight: "100vh" }}
        role="dialog"
        aria-modal="true"
        aria-label="Mobile sidebar"
      >
        <div className="h-16 flex items-center px-4 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-[#0ea5e9] to-[#196e87] p-2 rounded-lg shadow">
              <img src="/images/logo.png" alt="logo" className="h-6 w-auto" />
            </div>
            <div>
              <div className="text-lg font-bold">EventHub</div>
              <div className="text-xs text-slate-400">Admin</div>
            </div>
          </div>

          <button onClick={onClose} className="ml-auto p-2 rounded bg-white/5 hover:bg-white/10" aria-label="Close menu">
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <NavList onItemClick={onClose} />
      </aside>
    </>
  ) : null;

  return (
    <>
      {Desktop}
      {Mobile}
    </>
  );
}