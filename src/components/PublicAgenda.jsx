import React, { useState, useEffect } from "react";

export default function PublicAgenda() {
  const [agendaData, setAgendaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const API_BASE = process.env.REACT_APP_API_BASE_URL || "";

  useEffect(() => {
    fetchAgenda();
  }, []);

  const fetchAgenda = async () => {
    setLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/agenda`, {
        headers: {
          "ngrok-skip-browser-warning": "69420"
        }
      });
      const data = await res.json();
      if (data.success) {
        setAgendaData(data.data);
      } else {
        setError("Failed to load agenda");
      }
    } catch (error) {
      console.error("Error fetching agenda:", error);
      setError("Failed to load agenda");
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow border text-center">
        <div className="text-gray-600">Loading agenda...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white p-6 rounded-xl shadow border text-center">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  if (!agendaData || !agendaData.fileUrl) {
    return (
      <div className="bg-white p-6 rounded-xl shadow border text-center">
        <div className="text-gray-600">Agenda will be available soon.</div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow border">
      <h2 className="text-2xl font-bold text-[#21809b] mb-2">
        {agendaData.title || "Program Agenda"}
      </h2>
      <p className="text-gray-600 mb-4">
        {agendaData.description || "Download the program agenda for 6th RailTrans Expo 2026"}
      </p>
      <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
        <div>
          <p className="font-medium text-gray-700">{agendaData.fileName}</p>
          <p className="text-sm text-gray-500">
            Last updated: {new Date(agendaData.updatedAt).toLocaleDateString()}
          </p>
        </div>
        <a
          href={agendaData.fileUrl}
          download
          className="px-6 py-2 bg-[#21809b] text-white rounded-lg hover:bg-[#1a6a80] transition-colors flex items-center gap-2"
        >
          <span>📄</span> Download Agenda
        </a>
      </div>
    </div>
  );
}