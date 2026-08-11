import React, { useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { MIN_PASSWORD_LENGTH } from "../service/auth";
import "./Login.css";

/**
 * Sign in / create account.
 *
 * Accounts are stored in this browser only — see service/auth.js. The notice at
 * the bottom of the card says so, because a sign-in form that looks like every
 * other sign-in form otherwise implies a server that does not exist.
 */
const Login = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { signIn, signUp, isBusy } = useAuth();

  const [mode, setMode] = useState("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState(null);

  // Where to go after signing in: back to whatever required auth, or the
  // dashboard. Set by the redirect in RequireAuth.
  const redirectTo = location.state?.from || "/";
  const isSignUp = mode === "signup";

  const switchMode = (next) => {
    setMode(next);
    setError(null);
    setConfirm("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);

    if (isSignUp && password !== confirm) {
      setError("Passwords do not match.");
      return;
    }

    try {
      if (isSignUp) {
        await signUp(email, password);
      } else {
        await signIn(email, password);
      }
      navigate(redirectTo, { replace: true });
    } catch (err) {
      setError(err.message || "Something went wrong. Try again.");
    }
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="auth-brand">
          <div className="auth-logo">Z</div>
          <span className="auth-brand-name">Zenith</span>
        </div>

        <h1 className="auth-title">
          {isSignUp ? "Create your account" : "Welcome back"}
        </h1>
        <p className="auth-subtitle">
          {isSignUp
            ? "You need an account to start a meeting."
            : "Sign in to start a meeting and see your history."}
        </p>

        <div className="auth-tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={!isSignUp}
            className={`auth-tab${!isSignUp ? " active" : ""}`}
            onClick={() => switchMode("signin")}
          >
            Sign in
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={isSignUp}
            className={`auth-tab${isSignUp ? " active" : ""}`}
            onClick={() => switchMode("signup")}
          >
            Create account
          </button>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          <div className="auth-field">
            <label htmlFor="auth-email">Email</label>
            <input
              id="auth-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              autoComplete="email"
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="auth-password">Password</label>
            <div className="auth-password-wrapper">
              <input
                id="auth-password"
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={
                  isSignUp ? `At least ${MIN_PASSWORD_LENGTH} characters` : "Your password"
                }
                autoComplete={isSignUp ? "new-password" : "current-password"}
                minLength={isSignUp ? MIN_PASSWORD_LENGTH : undefined}
                required
              />
              <button
                type="button"
                className="auth-password-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {isSignUp && (
            <div className="auth-field">
              <label htmlFor="auth-confirm">Confirm password</label>
              <input
                id="auth-confirm"
                type={showPassword ? "text" : "password"}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                placeholder="Re-enter your password"
                autoComplete="new-password"
                required
              />
            </div>
          )}

          {error && (
            <div className="auth-error" role="alert">
              {error}
            </div>
          )}

          <button type="submit" className="auth-submit" disabled={isBusy}>
            {isBusy
              ? "Working…"
              : isSignUp
              ? "Create account"
              : "Sign in"}
          </button>
        </form>

        <p className="auth-notice">
          Accounts are stored in this browser only. There is no server holding
          your details, and clearing site data removes them. Please don't reuse a
          password from anywhere else.
        </p>

        <button
          type="button"
          className="auth-back"
          onClick={() => navigate("/")}
        >
          Back
        </button>
      </div>
    </div>
  );
};

export default Login;
