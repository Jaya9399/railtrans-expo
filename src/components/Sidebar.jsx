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

/*
  Sidebar
  - Dark, compact sidebar.
  - Logout button moved up (just above the bottom area) and wired to clear auth tokens and navigate to /login.
  - useNavigate used to programmatically redirect after logout.
*/

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
      { label: "Ticket Categories", icon: HiOutlineTable, path: "/ticket-categories" },
    ],
  },
];

function MenuItem({ item }) {
  const Icon = item.icon;
  return (
    <NavLink
      to={item.path}
      className={({ isActive }) =>
        `group flex items-center gap-3 px-4 py-2 rounded-lg transition-colors duration-150
         ${
           isActive
             ? "bg-white/10 text-white font-semibold"
             : "text-gray-300 hover:bg-white/5"
         }`
      }
      end
    >
      <span className="flex items-center justify-center w-10 h-10 rounded-lg transition-colors duration-150" aria-hidden>
        <Icon className="text-xl" />
      </span>

      <span className="flex-1 text-sm">{item.label}</span>

      <HiOutlineChevronRight className="text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </NavLink>
  );
}

export default function Sidebar() {
  const navigate = useNavigate();

  const handleLogout = React.useCallback(() => {
    // Clear authentication state (adjust keys to your app)
    try {
      // remove known tokens / user state
      localStorage.removeItem("authToken");
      localStorage.removeItem("user");
      sessionStorage.removeItem("authToken");
      // If you store other keys, remove them here
      // Optionally clear all: localStorage.clear();

      // Optionally clear cookies named "token" (best-effort)
      document.cookie.split(";").forEach((c) => {
        const name = c.split("=")[0].trim();
        // adjust cookie name(s) as needed
        if (name === "token" || name === "authToken") {
          document.cookie = `${name}=;expires=Thu, 01 Jan 1970 00:00:00 GMT;path=/;`;
        }
      });
    } catch (e) {
      // ignore
      console.warn("logout cleanup error", e);
    }

    // Navigate to login page and replace history so user can't go back to protected routes
    navigate("/", { replace: true });
  }, [navigate]);

  return (
    <aside className="bg-[#0f1724] text-white w-64 min-h-screen flex flex-col">
      {/* Top: Logo */}
      <div className="px-4 pt-6 pb-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="bg-gradient-to-br from-[#0ea5e9] to-[#196e87] p-2 rounded-lg shadow" aria-hidden>
              {/* small placeholder logo */}
              
            </div>
            <div>
              <div className="text-lg font-bold">EventHub</div>
              <div className="text-xs text-gray-400">Admin</div>
            </div>
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav className="flex-1 overflow-y-auto px-2 pb-4">
        {menuSections.map((section) => (
          <div key={section.title} className="mb-6">
            <div className="px-3 text-xs uppercase text-gray-500 font-semibold mb-2">{section.title}</div>
            <div className="space-y-1">
              {section.items.map((item) => (
                <MenuItem key={item.path} item={item} />
              ))}
            </div>
          </div>
        ))}

        {/* Secondary quick links */}
        {/* <div className="mt-4 pt-4 border-t border-white/6">
          <div className="px-3 text-xs uppercase text-gray-500 font-semibold mb-2">Management</div>
          <div className="space-y-1">
            <NavLink to="/reports" className={({ isActive }) => `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${isActive ? "bg-white/10 text-white font-semibold" : "text-gray-300 hover:bg-white/5"}`}>
              <HiOutlineChartBar className="text-xl" /><span className="text-sm">Reports</span>
            </NavLink>
            <NavLink to="/messages" className={({ isActive }) => `flex items-center gap-3 px-4 py-2 rounded-lg transition-colors ${isActive ? "bg-white/10 text-white font-semibold" : "text-gray-300 hover:bg-white/5"}`}>
              <HiOutlineMail className="text-xl" /><span className="text-sm">Messages</span>
            </NavLink>
          </div>
        </div> */}
      </nav>

      {/* Logout moved a bit above the bottom; visible and accessible */}
      <div className="px-4 pb-4">
        <button
          onClick={handleLogout}
          className="w-full flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-red-600/10 text-red-400"
        >
          <HiOutlineLockClosed className="text-lg" />
          <span className="text-sm">Logout</span>
        </button>
      </div>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-white/6 text-xs text-gray-400">
        © {new Date().getFullYear()} RailTrans Expo
      </div>
    </aside>
  );
}