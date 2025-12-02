import React from "react";
import { Navigate } from "react-router-dom";
import { useAuth } from "./AuthContext";

/**
 * Allow only support@railtransexpo.com.
 * If not logged in -> redirect to "/login" (so you can test easily)
 * If logged in but not admin -> show "Access denied"
 */
const ADMIN_EMAIL = "support@railtransexpo.com";

export default function AdminRoute({ children }) {
  const { user } = useAuth();

  if (!user) {
    // Not authenticated — redirect to login for easier testing
    return <Navigate to="/login" replace />;
  }

  if (!user.email || user.email.toLowerCase().trim() !== ADMIN_EMAIL.toLowerCase()) {
    // Authenticated but not admin
    return <div className="p-8">Access denied — admin only</div>;
  }

  return children;
}