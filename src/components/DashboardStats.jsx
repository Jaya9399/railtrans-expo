import React from "react";

export default function DashboardStats({ stats }) {
  const cards = [
    { label: "Visitors", count: stats.visitors },
    { label: "Exhibitors", count: stats.exhibitors },
    { label: "Partners", count: stats.partners },
    { label: "Speakers", count: stats.speakers, hiddenClass: "hidden md:block" },
    { label: "Awardees", count: stats.awardees, hiddenClass: "hidden lg:block" },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mt-4">
      {cards.map(({ label, count, hiddenClass }) => (
        <div
          key={label}
          className={`bg-white rounded-lg p-3 shadow ${hiddenClass ? hiddenClass : ""}`}
        >
          <div className="text-xs text-gray-500">{label}</div>
          <div className="text-2xl font-bold">{count}</div>
        </div>
      ))}
    </div>
  );
}