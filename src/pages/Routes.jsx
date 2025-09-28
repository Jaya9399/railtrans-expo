import React from "react";
import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import AdminPanel from "./AdminPanel";
import Visitors from "./Visitors"; 
import Exhibitors from "./Exhibitors";
import Partners from "./Partners";
import Speakers from "./Speakers";
import Awardees from "./Awardees";

// Example placeholder pages for registration and others
function VisitorRegistration() {
  return <div className="p-8">Visitor Registration Page</div>;
}
function ExhibitorRegistration() {
  return <div className="p-8">Exhibitor Registration Page</div>;
}
function PartnerRegistration() {
  return <div className="p-8">Partner Registration Page</div>;
}
function SpeakerRegistration() {
  return <div className="p-8">Speaker Registration Page</div>;
}
function AwardeeRegistration() {
  return <div className="p-8">Awardee Registration Page</div>;
}

export default function AppRoutes() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<AdminPanel />} />
        <Route path="/visitors" element={<Visitors />} /> {/* Added Visitors page route */}
        <Route path="/visitor-registration" element={<VisitorRegistration />} />
        <Route path="/exhibitor-registration" element={<ExhibitorRegistration />} />
        <Route path="/partner-registration" element={<PartnerRegistration />} />
        <Route path="/speaker-registration" element={<SpeakerRegistration />} />
        <Route path="/awardee-registration" element={<AwardeeRegistration />} />
        <Route path="/Exhibitors" element={<Exhibitors />} /> {/* Added Visitors page route */}
        <Route path="/Partners" element={<Partners />} /> {/* Added Visitors page route */}
        <Route path="/Speakers" element={<Speakers />} /> {/* Added Visitors page route */}
        <Route path="/Awardees" element={<Awardees />} /> {/* Added Visitors page route */}
        {/* Add more routes as needed */}
      </Routes>
    </Router>
  );
}