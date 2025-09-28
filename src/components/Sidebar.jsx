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

// Add all your registration pages here!
const menuSections = [
  {
    title: "MAIN",
    items: [
      { label: "Dashboard", icon: HiOutlineViewGrid },
      { label: "Visitors", icon: HiOutlineUserGroup },
      { label: "Exhibitors", icon: HiOutlineBriefcase },
      { label: "Partners", icon: HiOutlineHand },
      { label: "Speakers", icon: HiOutlineSpeakerphone },
      { label: "Awardees", icon: HiOutlineUserCircle },
      { label: "Registrations", icon: HiOutlineClipboardList },
      { label: "Events Calendar", icon: HiOutlineCalendar },
      { label: "Documents", icon: HiOutlineDocumentText },
      { label: "Reports", icon: HiOutlineTable },
      { label: "Pages", icon: HiOutlineFolderOpen },
    ],
  },
  {
    title: "COMMUNICATION",
    items: [
      { label: "Chat", icon: HiOutlineChatAlt },
      { label: "Support Tickets", icon: HiOutlineSupport },
      { label: "Emails", icon: HiOutlineMail },
    ],
  },
  {
    title: "ANALYTICS",
    items: [
      { label: "Charts", icon: HiOutlineChartBar },
      { label: "Statistics", icon: HiOutlineCube },
    ],
  },
  {
    title: "SETTINGS",
    items: [
      { label: "Authentication", icon: HiOutlineLockClosed },
      { label: "Admin Settings", icon: HiOutlineCog },
    ],
  },
];

function SidebarMenuItem({ item, selected, onSelect }) {
  const [open, setOpen] = useState(false);
  const hasChildren = item.children && item.children.length > 0;
  return (
    <div>
      <button
        className={`flex items-center w-full px-4 py-2 rounded-lg hover:bg-gray-100 text-gray-700 transition ${
          selected === item.label ? "bg-gray-100 font-semibold" : ""
        }`}
        onClick={() => {
          if (hasChildren) setOpen((o) => !o);
          else onSelect(item.label);
        }}
      >
        <item.icon className="mr-3 text-xl" />
        <span className="flex-1 text-left">{item.label}</span>
        {item.badge && (
          <span className="ml-2 text-xs bg-green-100 text-green-600 rounded px-2 py-0.5 font-bold">
            {item.badge}
          </span>
        )}
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
              onClick={() => onSelect(child.label)}
            >
              {child.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export default function Sidebar({ selected, onSelect }) {
  return (
    <aside className="bg-white w-64 min-h-screen border-r flex flex-col fixed left-0 z-30 pt-0">
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