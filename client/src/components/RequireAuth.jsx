import React from "react";
import { Navigate, useLocation } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";

/**
 * Redirects to the login screen when there is no signed-in account.
 *
 * Only wraps routes that genuinely need an account — history, and creating a
 * meeting. Joining a shared invite link deliberately stays open, because
 * requiring the person you invited to register first defeats the point of
 * sending them a link.
 */
const RequireAuth = ({ children }) => {
  const { isSignedIn } = useAuth();
  const location = useLocation();

  if (!isSignedIn) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location.pathname + location.search }}
      />
    );
  }

  return children;
};

export default RequireAuth;
