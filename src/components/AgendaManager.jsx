import React, { useState, useEffect } from "react";

export default function AgendaManager() {
  const [agendaData, setAgendaData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState(null);
  const [title, setTitle] = useState("Program Agenda");
  const [description, setDescription] = useState("Download the program agenda for 6th RailTrans Expo 2026");
  const [message, setMessage] = useState(null);
  const [messageType, setMessageType] = useState("success");

 const API_BASE =
  (process.env.REACT_APP_API_BASE_URL || "").replace(/\/$/, "");

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
        setTitle(data.data.title || "Program Agenda");
        setDescription(data.data.description || "Download the program agenda for 6th RailTrans Expo 2026");
      }
    } catch (error) {
      console.error("Error fetching agenda:", error);
      setMessage("Failed to load agenda data");
      setMessageType("error");
    } finally {
      setLoading(false);
    }
  };

  const handleFileChange = (e) => {
    const selectedFile = e.target.files[0];
    if (selectedFile) {
      const allowedTypes = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.openxmlformats-officedocument.presentationml.presentation', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'];
      if (!allowedTypes.includes(selectedFile.type)) {
        setMessage("Only PDF, DOC, DOCX, PPTX, and XLSX files are allowed");
        setMessageType("error");
        setFile(null);
        e.target.value = '';
        return;
      }
      if (selectedFile.size > 10 * 1024 * 1024) {
        setMessage("File size must be less than 10MB");
        setMessageType("error");
        setFile(null);
        e.target.value = '';
        return;
      }
      setFile(selectedFile);
      setMessage(null);
    }
  };

  const handleUpload = async () => {
    if (!file) {
      setMessage("Please select a file to upload");
      setMessageType("error");
      return;
    }

    setUploading(true);
    setMessage(null);

    const formData = new FormData();
    formData.append("agendaFile", file);
    formData.append("title", title);
    formData.append("description", description);

    try {
      const res = await fetch(`${API_BASE}/api/agenda/upload`, {
        method: "POST",
        body: formData,
        headers: {
          "ngrok-skip-browser-warning": "69420"
        }
      });

      const data = await res.json();
      if (data.success) {
        setMessage("Agenda uploaded successfully!");
        setMessageType("success");
        setFile(null);
        document.getElementById('fileInput').value = '';
        await fetchAgenda();
        setTimeout(() => setMessage(null), 5000);
      } else {
        setMessage(data.error || "Upload failed");
        setMessageType("error");
      }
    } catch (error) {
      setMessage("Error uploading file");
      setMessageType("error");
    } finally {
      setUploading(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete the agenda file?")) return;

    try {
      const res = await fetch(`${API_BASE}/api/agenda`, {
        method: "DELETE",
        headers: {
          "ngrok-skip-browser-warning": "69420"
        }
      });

      const data = await res.json();
      if (data.success) {
        setMessage("Agenda deleted successfully!");
        setMessageType("success");
        setAgendaData(null);
        await fetchAgenda();
        setTimeout(() => setMessage(null), 5000);
      } else {
        setMessage(data.error || "Delete failed");
        setMessageType("error");
      }
    } catch (error) {
      setMessage("Error deleting agenda");
      setMessageType("error");
    }
  };

  if (loading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow border">
        <div className="text-center py-8 text-gray-600">Loading...</div>
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow border">
      <h2 className="text-2xl font-bold text-[#21809b] mb-4">Program Agenda Manager</h2>
      
      {message && (
        <div className={`p-3 rounded-lg mb-4 ${messageType === "success" ? "bg-green-50 border border-green-200 text-green-700" : "bg-red-50 border border-red-200 text-red-700"}`}>
          {message}
        </div>
      )}

      {/* Current Agenda Info */}
      {agendaData && agendaData.fileUrl && (
        <div className="mb-6 p-4 bg-gray-50 rounded-lg border">
          <h3 className="font-semibold text-gray-700 mb-2">Current Agenda</h3>
          <div className="flex items-center justify-between">
            <div>
              <p><strong>File:</strong> {agendaData.fileName}</p>
              <p><strong>Size:</strong> {(agendaData.fileSize / 1024).toFixed(2)} KB</p>
              <p><strong>Uploaded:</strong> {new Date(agendaData.updatedAt).toLocaleString()}</p>
            </div>
            <div className="flex gap-2">
              <a
                href={agendaData.fileUrl}
                download
                className="px-4 py-2 bg-[#21809b] text-white rounded-lg hover:bg-[#1a6a80] transition-colors"
              >
                Download
              </a>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Upload Form */}
      <div className="space-y-4">
        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Title
          </label>
          <input
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="w-full p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base"
            placeholder="Enter agenda title"
          />
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            className="w-full p-2 rounded-lg bg-[#eaf6fb] border border-[#bde0fe] text-base"
            rows={3}
            placeholder="Enter description"
          />
        </div>

        <div>
          <label className="block font-semibold text-gray-700 mb-1">
            Upload Agenda File (PDF, DOC, DOCX, PPTX, XLSX - Max 10MB)
          </label>
          <input
            id="fileInput"
            type="file"
            onChange={handleFileChange}
            className="w-full p-2 border rounded-lg"
            accept=".pdf,.doc,.docx,.pptx,.xlsx"
          />
          {file && (
            <div className="mt-2 text-sm text-green-600">
              Selected: {file.name} ({(file.size / 1024).toFixed(2)} KB)
            </div>
          )}
        </div>

        <button
          onClick={handleUpload}
          disabled={uploading || !file}
          className="w-full px-4 py-2 bg-[#21809b] text-white rounded-lg hover:bg-[#1a6a80] transition-colors disabled:opacity-50"
        >
          {uploading ? "Uploading..." : agendaData?.fileUrl ? "Update Agenda" : "Upload Agenda"}
        </button>
      </div>
    </div>
  );
}