import React from "react";
import { NavLink } from "react-router-dom";
import {
  HiOutlineViewGrid,
  HiOutlineUserGroup,
  HiOutlineBriefcase,
  HiOutlineSpeakerphone,
  HiOutlineHand,
  HiOutlineUserCircle,
  HiOutlineClipboardList,
  HiOutlineDocumentText,
  HiOutlineTable,
  HiOutlineFolderOpen,
  HiOutlineChatAlt,
  HiOutlineSupport,
  HiOutlineMail,
  HiOutlineChartBar,
  HiOutlineCube,
  HiOutlineLockClosed,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineCog,
} from "react-icons/hi";

/**
 * Updated Sidebar that uses NavLink for routing instead of buttons invoking a handler.
 *
 * Why your /VisitorsAdmin route likely wasn't opening:
 * - The previous Sidebar used button clicks + onSelect callbacks to navigate.
 *   If the parent didn't call react-router's navigate() or update location, the route URL may change
 *   but React Router wouldn't render the new route (or nothing happened).
 * - Using NavLink/Link ensures client-side navigation handled by react-router and avoids full page reloads.
 * - Also ensure the path strings match exactly the Route definitions (case-sensitive on some platforms).
 *
 * Fixes in this file:
 * - Use NavLink to navigate to item.path.
 * - Apply active styling via NavLink's isActive.
 * - Keep a fallback onSelect prop for non-router usage (optional).
 *
 * Install react-icons if you haven't: npm install react-icons
 */

const menuSections = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: HiOutlineViewGrid, path: "/admin" },
      { label: "Visitors", icon: HiOutlineUserGroup, path: "/VisitorsAdmin" },
      { label: "Exhibitors", icon: HiOutlineBriefcase, path: "/ExhibitorsAdmin" },
      { label: "Partners", icon: HiOutlineHand, path: "/PartnersAdmin" },
      { label: "Speakers", icon: HiOutlineSpeakerphone, path: "/SpeakersAdmin" },
      { label: "Awardees", icon: HiOutlineUserCircle, path: "/AwardeesAdmin" },
      { label: "Topbar Settings", icon: HiOutlineDocumentText, path: "/admin/topbar-settings" },
      { label: "Ticket Categories", icon: HiOutlineTable, path: "/payments-summary" },
      { label: "Registrations", icon: HiOutlineClipboardList, path: "/registrations" },
    ],
  },
  
];

function MenuItem({ item }) {
  const Icon = item.icon;
  const isRoot = item.path === "/";

  // NavLink with `end` prop for exact match on root path
  return (
    <NavLink
      to={item.path}
      end={isRoot}
      className={({ isActive }) =>
        `flex items-center gap-3 px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition ${
          isActive ? "bg-gray-100 font-semibold" : ""
        }`
      }
    >
      <Icon className="mr-3 text-xl" />
      <span className="flex-1 text-left">{item.label}</span>
    </NavLink>
  );
}

export default function Sidebar({ fixed = false }) {
  const baseClass = fixed
    ? "bg-white w-64 min-h-screen border-r flex flex-col fixed left-0 z-30 pt-0"
    : "bg-white w-64 min-h-screen border-r flex flex-col";

  return (
    <aside className={baseClass}>
      <nav className="flex-1 overflow-y-auto mt-8">
        <div className="py-4">
          {menuSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="px-6 text-xs font-bold text-gray-400 mb-2 uppercase">{section.title}</div>
              <div className="space-y-1 px-2">
                {section.items.map((item) => (
                  <div key={item.path}>
                    <MenuItem item={item} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="px-6 py-4 border-t text-xs text-gray-400">&copy; {new Date().getFullYear()} RailTrans Expo</div>
    </aside>
  );
}