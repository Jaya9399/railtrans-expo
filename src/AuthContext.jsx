import React, { createContext, useContext, useEffect, useState } from "react";

/**
 * Lightweight AuthContext (with console logs for debugging).
 * Replace with your real auth provider when ready.
 */
const AuthContext = createContext({ user: null, login: () => {}, logout: () => {} });

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem("user");
      const parsed = raw ? JSON.parse(raw) : null;
      console.log("[AuthContext] loaded user from localStorage:", parsed);
      setUser(parsed);
    } catch (e) {
      console.error("[AuthContext] error reading user from localStorage", e);
    }
  }, []);

  function login(userObj) {
    console.log("[AuthContext] login()", userObj);
    setUser(userObj);
    try {
      localStorage.setItem("user", JSON.stringify(userObj));
    } catch (e) {
      console.error("[AuthContext] error saving user to localStorage", e);
    }
  }

  function logout() {
    console.log("[AuthContext] logout()");
    setUser(null);
    try {
      localStorage.removeItem("user");
    } catch (e) {
      console.error("[AuthContext] error removing user from localStorage", e);
    }
  }

  return (
    <AuthContext.Provider value={{ user, login, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}

export default AuthContext;