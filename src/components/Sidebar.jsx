import React, { useState } from "react";
import {
  HiOutlineViewGrid,
  HiOutlineUserGroup,
  HiOutlineBriefcase,
  HiOutlineSpeakerphone,
  HiOutlineHand,
  HiOutlineUserCircle,
  HiOutlineClipboardList,
  HiOutlineCalendar,
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
  HiOutlineCog
} from "react-icons/hi";

// menu with path entries for router navigation
const menuSections = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: HiOutlineViewGrid, path: "/" },
      { label: "Visitors", icon: HiOutlineUserGroup, path: "/VisitorsAdmin" },
      { label: "Exhibitors", icon: HiOutlineBriefcase, path: "/ExhibitorsAdmin" },
      { label: "Partners", icon: HiOutlineHand, path: "/PartnersAdmin" },
      { label: "Speakers", icon: HiOutlineSpeakerphone, path: "/SpeakersAdmin" },
      { label: "Awardees", icon: HiOutlineUserCircle, path: "/AwardeesAdmin" },
      { label: "Topbar Settings", icon: HiOutlineDocumentText, path: "/admin/topbar-settings" },
      { label: "Ticket Categories", icon: HiOutlineTable, path: "/payments-summary" },
      { label: "Registrations", icon: HiOutlineClipboardList, path: "/registrations" },
      { label: "Pages", icon: HiOutlineFolderOpen, path: "/pages" },
    ],
  },
  {
    title: "COMMUNICATION",
    items: [
      { label: "Chat", icon: HiOutlineChatAlt, path: "/chat" },
      { label: "Support Tickets", icon: HiOutlineSupport, path: "/support" },
      { label: "Emails", icon: HiOutlineMail, path: "/emails" },
    ],
  },
  {
    title: "ANALYTICS",
    items: [
      { label: "Charts", icon: HiOutlineChartBar, path: "/charts" },
      { label: "Statistics", icon: HiOutlineCube, path: "/stats" },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      { label: "Authentication", icon: HiOutlineLockClosed, path: "/auth" },
      { label: "Admin Settings", icon: HiOutlineCog, path: "/settings" },
    ],
  },
];

function SidebarMenuItem({ item, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;

  function handleClick() {
    if (hasChildren) {
      setOpen((o) => !o);
      return;
    }
    if (typeof onSelect === "function") onSelect(item.path || item.label);
  }

  return (
    <div>
      <button
        className={`flex items-center w-full px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition ${
          selected === (item.path || item.label) ? "bg-gray-100 font-semibold" : ""
        }`}
        onClick={handleClick}
      >
        <item.icon className="mr-3 text-xl" />
        <span className="flex-1 text-left">{item.label}</span>
        {hasChildren &&
          (open ? (
            <HiOutlineChevronDown className="ml-2 text-sm" />
          ) : (
            <HiOutlineChevronRight className="ml-2 text-sm" />
          ))}
      </button>

      {hasChildren && open && (
        <div className="ml-8 mt-1 space-y-1">
          {item.children.map((child) => (
            <button
              key={child.label}
              className={`w-full text-left px-2 py-1 rounded hover:bg-gray-50 text-gray-600 text-sm`}
              onClick={() => onSelect(child.path || child.label)}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Sidebar
 * Props:
 * - selected: current path/selection
 * - onSelect: function(pathOrLabel)
 * - fixed: boolean (default: false) — if true, positions the sidebar fixed on the left
 *
 * Default changed to non-fixed so Topbar can span full width. If you want the previous behavior
 * (sidebar fixed on left and content offset with ml-64), pass fixed={true}.
 */
export default function Sidebar({ selected, onSelect, fixed = false }) {
  const baseClass = fixed
    ? "bg-white w-64 min-h-screen border-r flex flex-col fixed left-0 z-30 pt-0"
    : "bg-white w-64 min-h-screen border-r flex flex-col";

  return (
    <aside className={baseClass}>
      <nav className="flex-1 overflow-y-auto mt-8">
        <div className="py-4">
          {menuSections.map((section) => (
            <div key={section.title} className="mb-6">
              <div className="px-6 text-xs font-bold text-gray-400 mb-2 uppercase">
                {section.title}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => (
                  <SidebarMenuItem
                    key={item.label}
                    item={item}
                    selected={selected}
                    onSelect={onSelect}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </nav>
      <div className="px-6 py-4 border-t text-xs text-gray-400">
        &copy; {new Date().getFullYear()} RailTrans Expo
      </div>
    </aside>
  );
}