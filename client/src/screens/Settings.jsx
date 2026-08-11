import React from "react";
import { useNavigate } from "react-router-dom";
import SettingsContent from "./SettingsContent";
import "./Settings.css";

/**
 * Standalone /settings page.
 *
 * Only the page chrome lives here — the settings themselves are SettingsContent,
 * which the dashboard also embeds in its Settings tab. The two used to be
 * near-identical 600-line copies of each other, so a change to one silently left
 * the other behind.
 */
const Settings = () => {
  const navigate = useNavigate();

  return (
    <div className="settings-page-wrapper">
      <header className="settings-header">
        <div className="settings-header-left">
          <button className="back-to-dashboard" onClick={() => navigate("/")}>
            <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10 19l-7-7m0 0l7-7m-7 7h18"
              />
            </svg>
            Back to Dashboard
          </button>
        </div>
        <div className="settings-header-center">
          <h1 className="settings-page-title">Settings</h1>
          <p className="settings-page-subtitle">
            Manage your account settings and preferences
          </p>
        </div>
        <div className="settings-header-right" />
      </header>

      <SettingsContent />
    </div>
  );
};

export default Settings;
