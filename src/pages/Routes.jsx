import React from "react";
import { Routes, Route } from "react-router-dom";
import DashboardContent from "./DashboardContent";
import Visitors from "./Visitors";
import Exhibitors from "./Exhibitors";
import Partners from "./Partners";
import Speakers from "./Speakers";
import Awardees from "./Awardees";
import AdminExhibitors from "./AdminExhibitor";
import VisitorsAdmin from "./VisitorsAdmin";
import ExhibitorsAdmin from "./ExhibitorsAdmin";
import PartnersAdmin from "./PartnersAdmin";
import SpeakersAdmin from "./SpeakersAdmin";
import AwardeesAdmin from "./AwardeesAdmin";
import AdminPartners from "./AdminPartner";
import AdminTopbarSettings from "./AdminTopbarSettings";
import PaymentsSummary from "./PaymentSummary";
import AdminRoute from "../AdminRoute";
import { AuthProvider } from "../AuthContext";
import AdminPortal from "../AdminPortal";
import AdminLayout from "../AdminLayout";
import AdminLogin from "../components/AdminLogin";
import TicketDownload from "./TicketDownload";
import TicketUpgrade from "./TicketUpgrade";
import EventDetailsAdmin from "./EventDetailsAdmin";

// Simple placeholders (if you need them)
function Registrations() {
  return <div className="p-8">Registrations</div>;
}
function Documents() {
  return <div className="p-8">Documents</div>;
}

export default function AppRoutes() {
  return (
    // Wrap routes with AuthProvider so AdminRoute can read the user.
    // If you already wrap your app with a provider higher up (e.g. in index.jsx), remove this wrapper.
    <AuthProvider>
      <Routes>
        <Route path="/" element={<AdminPortal />} />

        {/* Public pages */}
        <Route path="/visitors" element={<Visitors />} />
        <Route path="/exhibitors" element={<Exhibitors />} />
        <Route path="/partners" element={<Partners />} />
        <Route path="/speakers" element={<Speakers />} />
        <Route path="/awardees" element={<Awardees />} />
        <Route path="/admin-login" element={<AdminLogin open={true} />} />
        <Route path="/ticket-download" element={<TicketDownload />} />
        <Route path="/ticket-upgrade" element={<TicketUpgrade />} />
        {/* AdminPortal route */}
        {/* Option A — Unprotected: anyone can open /admin-portal (page provides login UI) */}
        <Route path="/admin-portal" element={<AdminPortal />} />
        <Route
          path="/admin"
          element={
            <AdminRoute>
              <AdminLayout>
                <DashboardContent />
              </AdminLayout>
            </AdminRoute>
          }
        />
        {/* Admin-only pages (guarded) */}
        <Route
          path="/VisitorsAdmin"
          element={
            <AdminRoute>
              <VisitorsAdmin />
            </AdminRoute>
          }
        />

        <Route
          path="/ExhibitorsAdmin"
          element={
            <AdminRoute>
              <ExhibitorsAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/PartnersAdmin"
          element={
            <AdminRoute>
              <PartnersAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/SpeakersAdmin"
          element={
            <AdminRoute>
              <SpeakersAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/AwardeesAdmin"
          element={
            <AdminRoute>
              <AwardeesAdmin />
            </AdminRoute>
          }
        />
        <Route
          path="/admin/topbar-settings"
          element={
            <AdminRoute>
              <AdminTopbarSettings />
            </AdminRoute>
          }
        />
        <Route
          path="/payments-summary"
          element={
            <AdminRoute>
              <PaymentsSummary />
            </AdminRoute>
          }
        />

        {/* Data admin pages */}
        <Route
          path="/exhibitors-data"
          element={
            <AdminRoute>
              <AdminExhibitors />
            </AdminRoute>
          }
        />
        <Route
          path="/partners-data"
          element={
            <AdminRoute>
              <AdminPartners />
            </AdminRoute>
          }
        />
        <Route
          path="/event-details-admin"
          element={
            <AdminRoute>
              <EventDetailsAdmin />
            </AdminRoute>
          }
        />

        {/* Other pages */}
        <Route path="/registrations" element={<Registrations />} />
        <Route path="/documents" element={<Documents />} />

        {/* fallback */}
        <Route
          path="*"
          element={<div className="p-8">404 — Page not found</div>}
        />
      </Routes>
    </AuthProvider>
  );
}
