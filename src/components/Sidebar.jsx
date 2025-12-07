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
 * Responsive Sidebar
 * Props:
 *  - open (bool): on small screens controls overlay visibility (default false)
 *  - onClose (fn): called to request closing the sidebar (mobile)
 *
 * Usage:
 *  <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
 *
 * Behavior:
 *  - Hidden on small screens by default and slides in when `open` is true.
 *  - Fixed left column (w-64) on md+ screens.
 *  - Closes on nav item click (so mobile users return to content).
 */

export default function Sidebar({ open = false, onClose = () => {} }) {
  const navigate = useNavigate();

  const menuSections = [
    {
      title: "Management",
      items: [
        { label: "Overview", icon: HiOutlineViewGrid, path: "/admin" },
        { label: "Visitors", icon: HiOutlineUserGroup, path: "/VisitorsAdmin" },
        { label: "Exhibitors", icon: HiOutlineBriefcase, path: "/ExhibitorsAdmin" },
        { label: "Partners", icon: HiOutlineHand, path: "/PartnersAdmin" },
        { label: "Speakers", icon: HiOutlineSpeakerphone, path: "/SpeakersAdmin" },
        { label: "Awardees", icon: HiOutlineUserCircle, path: "/AwardeesAdmin" },
        { label: "Topbar-setting", icon: HiOutlineUserCircle, path: "/admin/topbar-settings" },
        { label: "Ticket Categories", icon: HiOutlineTable, path: "/ticket-categories" },
      ],
    },
  ];

  const handleLogout = React.useCallback(() => {
    try {
      // Remove common auth keys (adjust as required)
      localStorage.removeItem("authToken");
      localStorage.removeItem("user");
      sessionStorage.removeItem("authToken");
      sessionStorage.removeItem("user");
      // best-effort cookie removal
      document.cookie.split(";").forEach((c) => {
        const name = c.split("=")[0].trim();
        if (!name) return;
        if (["token", "authToken", "session"].includes(name)) {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
        }
      });
    } catch (e) {
      console.warn("logout cleanup error", e);
    }
    // close sidebar (mobile) then navigate to root/login
    try { onClose(); } catch {}
    navigate("/", { replace: true });
  }, [navigate, onClose]);

  return (
    <>
      {/* Backdrop for mobile overlay */}
      <div
        className={`fixed inset-0 z-40 md:hidden transition-opacity ${open ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"}`}
        style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
        onClick={onClose}
        aria-hidden={!open}
      />

      {/* Sidebar panel */}
      <aside
        className={`fixed top-0 left-0 z-50 h-full w-64 bg-[#0f1724] text-white transform transition-transform duration-200
                    ${open ? "translate-x-0" : "-translate-x-full"} md:translate-x-0 md:static md:block`}
        style={{ minHeight: "100vh" }}
        aria-hidden={false}
        role="navigation"
        aria-label="Main navigation"
      >
        <div className="h-16 flex items-center px-4 border-b border-white/6">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-[#0ea5e9] to-[#196e87] p-2 rounded-lg shadow" aria-hidden>
              <img src="/images/logo.png" alt="RailTrans Expo" className="h-6 w-auto" />
            </div>
            <div>
              <div className="text-lg font-bold">EventHub</div>
              <div className="text-xs text-gray-400">Admin</div>
            </div>
          </div>

          {/* Close control visible only on mobile */}
          <button
            onClick={onClose}
            className="ml-auto md:hidden p-2 rounded bg-white/5 hover:bg-white/10"
            aria-label="Close menu"
            title="Close menu"
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M6 18L18 6M6 6l12 12" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-2 py-4">
          {menuSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="px-3 text-xs uppercase text-gray-500 font-semibold mb-2">{section.title}</div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.path}
                      to={item.path}
                      onClick={() => {
                        // close on mobile
                        try { onClose(); } catch {}
                      }}
                      className={({ isActive }) =>
                        `group flex items-center gap-3 px-4 py-2 rounded-lg transition-colors duration-150 mx-2 ${isActive ? "bg-white/10 text-white font-semibold" : "text-gray-300 hover:bg-white/5"}`
                      }
                      end
                    >
                      <span className="flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150 text-xl" aria-hidden>
                        <Icon />
                      </span>

                      <span className="flex-1 text-sm">{item.label}</span>

                      <HiOutlineChevronRight className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}

          <div className="mt-auto px-3 pb-6">
            <button
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-600/10 text-red-400"
            >
              <HiOutlineLockClosed className="text-lg" />
              <span className="text-sm">Logout</span>
            </button>
          </div>

          <div className="px-3 pt-2 text-xs text-slate-500">
            © {new Date().getFullYear()} RailTrans Expo
          </div>
        </nav>
      </aside>
    </>
  );
}