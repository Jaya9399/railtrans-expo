import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
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

// Simple placeholders (if you need them)
function Registrations() { return <div className="p-8">Registrations</div>; }
function Documents() { return <div className="p-8">Documents</div>; }

export default function AppRoutes() {
  return (
    <Routes>
      {/* Root -> dashboard */}
      <Route path="/" element={<DashboardContent />} />

      {/* Direct root-level admin pages (no /admin prefix) */}
      <Route path="/visitors" element={<Visitors />} />
      <Route path="/exhibitors" element={<Exhibitors />} />
      <Route path="/partners" element={<Partners />} />
      <Route path="/speakers" element={<Speakers />} />
      <Route path="/awardees" element={<Awardees />} />
      <Route path="/VisitorsAdmin" element={<VisitorsAdmin />} />
      <Route path="/ExhibitorsAdmin" element={<ExhibitorsAdmin />} />
      <Route path="/PartnersAdmin" element={<PartnersAdmin />} />
      <Route path="/SpeakersAdmin" element={<SpeakersAdmin />} />
      <Route path="/AwardeesAdmin" element={<AwardeesAdmin />} />
      <Route path="/admin/topbar-settings" element={<AdminTopbarSettings />} />
      <Route path="/payments-summary" element={<PaymentsSummary />} />
      

      {/* Exhibitors - Data admin page */}
      <Route path="/exhibitors-data" element={<AdminExhibitors />} />
      <Route path="/partners-data" element={<AdminPartners />} />
      {/* Other pages */}
      <Route path="/registrations" element={<Registrations />} />
      <Route path="/documents" element={<Documents />} />

      {/* fallback */}
      <Route path="*" element={<div className="p-8">404 — Page not found</div>} />
    </Routes>
  );
}