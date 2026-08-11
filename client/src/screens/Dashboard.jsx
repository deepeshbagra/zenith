import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import MeetingsPage from "./Meetings";
import SupportPage from "./Support";
import SettingsContent from "./SettingsContent";
import HistoryPage from "./History";
import { useAuth } from "../context/AuthProvider";
import { getHistory, getHistoryStats } from "../service/history";
import { generateRoomCode } from "../service/roomCode";
import "./Dashboard.css";

function formatRelative(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown";

  const minutes = Math.round((Date.now() - date.getTime()) / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;

  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;

  const days = Math.round(hours / 24);
  if (days === 1) return "yesterday";
  if (days < 7) return `${days} days ago`;

  return date.toLocaleDateString([], { day: "numeric", month: "short" });
}

const Dashboard = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const { user, isSignedIn, signOut } = useAuth();

  const [activeTab, setActiveTab] = useState("overview");
  const [showStartMeetingModal, setShowStartMeetingModal] = useState(false);
  const [roomCode, setRoomCode] = useState("");
  const [isDarkMode, setIsDarkMode] = useState(true);
  const [showUserMenu, setShowUserMenu] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Shown once to a guest returning from a call — see Room's handleLeave.
  const [showSignupPrompt, setShowSignupPrompt] = useState(
    () => Boolean(location.state?.promptSignup) && !isSignedIn
  );

  // Load theme preference. Falls back to the dark default, which is also the
  // initial value of isDarkMode.
  useEffect(() => {
    const savedTheme = localStorage.getItem("zenith_theme") || "dark";
    setIsDarkMode(savedTheme === "dark");
    document.documentElement.setAttribute("data-theme", savedTheme);
  }, []);

  // Apply theme
  useEffect(() => {
    const theme = isDarkMode ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("zenith_theme", isDarkMode ? "dark" : "light");
  }, [isDarkMode]);

  // Close user menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (showUserMenu && !event.target.closest('.user-menu-container')) {
        setShowUserMenu(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showUserMenu]);

  // Close mobile menu when clicking overlay
  const handleMobileMenuToggle = () => {
    setIsMobileMenuOpen(!isMobileMenuOpen);
  };

  const handleMobileMenuClose = () => {
    setIsMobileMenuOpen(false);
  };

  // Close mobile menu when route changes
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [activeTab]);

  // Close mobile menu on window resize (when switching to desktop)
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Toggle theme
  const toggleTheme = () => {
    setIsDarkMode(!isDarkMode);
  };

  // Clear the one-shot signup prompt from history state, so a refresh or a
  // back-navigation does not show it again.
  useEffect(() => {
    if (location.state?.promptSignup) {
      navigate(location.pathname, { replace: true, state: null });
    }
  }, [location.pathname, location.state, navigate]);

  const handleSignOut = () => {
    signOut();
    setShowUserMenu(false);
    setActiveTab("overview");
  };

  /**
   * Starting a meeting needs an account; joining someone else's invite link
   * does not. Guests who click this are sent to sign in first.
   */
  const handleRequestStartMeeting = () => {
    if (!isSignedIn) {
      navigate("/login", { state: { from: "/" } });
      return;
    }
    setRoomCode(generateRoomCode());
    setShowStartMeetingModal(true);
  };

  // Real figures, derived from meetings actually joined on this account.
  // Recomputed on tab change so returning to Overview reflects a meeting that
  // was joined since the dashboard mounted.
  const stats = useMemo(
    () => getHistoryStats(user?.email),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.email, activeTab]
  );

  const recentMeetings = useMemo(
    () => getHistory(user?.email).slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.email, activeTab]
  );

  const displayName = user ? user.email.split("@")[0] : "";
  const initials = displayName.slice(0, 2).toUpperCase() || "?";
  const todayLabel = new Date().toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const handleStartMeeting = () => {
    if (roomCode.trim()) {
      navigate(`/preview/${roomCode}`);
      setShowStartMeetingModal(false);
    }
  };

  const renderOverview = () => (
    <div className="overview-content">
      {/* Primary actions */}
      <div className="quick-actions">
        <button onClick={handleRequestStartMeeting} className="action-card primary">
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
          </svg>
          <span className="action-card-title">Start a meeting</span>
          <span className="action-card-sub">
            {isSignedIn ? "Create a room and invite others" : "Sign in to create a room"}
          </span>
        </button>

        <button
          onClick={() => { setRoomCode(""); setShowStartMeetingModal(true); }}
          className="action-card"
        >
          <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
          </svg>
          <span className="action-card-title">Join with a code</span>
          <span className="action-card-sub">Enter a code someone shared</span>
        </button>
      </div>

      {/*
        Figures below come from meetings actually joined on this account. They
        are only shown when signed in, because there is nothing to count for a
        guest and zeroes would read as a broken dashboard.
      */}
      {isSignedIn ? (
        <>
          <div className="stats-grid">
            <div className="stat-card">
              <div className="stat-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
              <div className="stat-info">
                <div className="stat-label">Meetings joined</div>
                <div className="stat-value">{stats.totalMeetings}</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
              </div>
              <div className="stat-info">
                <div className="stat-label">Distinct rooms</div>
                <div className="stat-value">{stats.uniqueRooms}</div>
              </div>
            </div>

            <div className="stat-card">
              <div className="stat-icon">
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <div className="stat-info">
                <div className="stat-label">Last meeting</div>
                <div className="stat-value small">
                  {stats.lastJoinedAt ? formatRelative(stats.lastJoinedAt) : "—"}
                </div>
              </div>
            </div>
          </div>

          <div className="content-section">
            <div className="section-header">
              <h2>Recent meetings</h2>
              {recentMeetings.length > 0 && (
                <button
                  className="btn-text"
                  onClick={() => setActiveTab("history")}
                >
                  View all
                </button>
              )}
            </div>

            {recentMeetings.length === 0 ? (
              <p className="section-empty">
                You haven't joined any meetings yet. Start one above, or open a
                code someone shared with you.
              </p>
            ) : (
              <ul className="recent-list">
                {recentMeetings.map((entry) => (
                  <li key={entry.id} className="recent-item">
                    <span className="recent-room">{entry.roomId}</span>
                    <span className="recent-time">
                      {formatRelative(entry.joinedAt)}
                    </span>
                    <button
                      className="btn-text"
                      onClick={() => navigate(`/preview/${entry.roomId}`)}
                    >
                      Rejoin
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      ) : (
        <div className="signin-callout">
          <h2>Sign in to keep your meeting history</h2>
          <p>
            You can join any meeting from a shared link without an account.
            Creating your own room and keeping a record of the meetings you've
            joined needs one.
          </p>
          <button onClick={() => navigate("/login")} className="btn-primary">
            Sign in or create an account
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="dashboard-container">
      {/* Mobile Menu Toggle */}
      <button 
        className="mobile-menu-toggle" 
        onClick={handleMobileMenuToggle}
        aria-label="Toggle menu"
      >
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
        </svg>
      </button>

      {/* Sidebar Overlay */}
      {isMobileMenuOpen && (
        <div 
          className="sidebar-overlay active" 
          onClick={handleMobileMenuClose}
          aria-hidden="true"
        />
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${isMobileMenuOpen ? 'mobile-open' : ''}`}>
        <div className="sidebar-header">
          <div className="logo-container">
            <div className="logo-icon">Z</div>
            <div className="logo-text">
              <div className="logo-title">Zenith</div>
              <div className="logo-subtitle">Video Platform</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <button
            className={`nav-item ${activeTab === 'overview' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('overview');
              setIsMobileMenuOpen(false);
            }}
          >
            <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
            </svg>
            Overview
          </button>

          <button
            className={`nav-item ${activeTab === 'meetings' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('meetings');
              setIsMobileMenuOpen(false);
            }}
          >
            <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            Meetings
          </button>

          {/* History needs an account, so it is hidden rather than shown empty. */}
          {isSignedIn && (
            <button
              className={`nav-item ${activeTab === 'history' ? 'active' : ''}`}
              onClick={() => {
                setActiveTab('history');
                setIsMobileMenuOpen(false);
              }}
            >
              <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              History
            </button>
          )}

          <button
            className={`nav-item ${activeTab === 'support' ? 'active' : ''}`}
            onClick={() => {
              setActiveTab('support');
              setIsMobileMenuOpen(false);
            }}
          >
            <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Help
          </button>
        </nav>

        <div className="sidebar-footer">
          <button
            className="settings-btn"
            onClick={() => {
              if (!isSignedIn) {
                navigate("/login", { state: { from: "/" } });
                return;
              }
              setActiveTab("settings");
              setIsMobileMenuOpen(false);
            }}
          >
            <svg className="nav-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            Settings
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="main-content">
        {/* Top Header */}
        <header className="top-header">
          <div className="header-left">
            <div className="header-date">{todayLabel}</div>
            <h1 className="workspace-title">
              {isSignedIn ? `Welcome back, ${displayName}` : "Zenith"}
            </h1>
          </div>

          <div className="header-right">
            <button className="btn-start-meeting" onClick={handleRequestStartMeeting}>
              Start Meeting
            </button>

            <button className="icon-btn" onClick={toggleTheme} title={isDarkMode ? "Light Mode" : "Dark Mode"}>
              {isDarkMode ? (
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            {isSignedIn ? (
              <div className="user-menu-container">
                <button className="user-btn" onClick={() => setShowUserMenu(!showUserMenu)}>
                  <span className="user-avatar">{initials}</span>
                  <span className="user-name">{displayName}</span>
                  <svg className="dropdown-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>

                {showUserMenu && (
                  <div className="user-dropdown">
                    <div className="user-dropdown-header">
                      <div className="dropdown-avatar">{initials}</div>
                      <div className="dropdown-user-info">
                        <div className="dropdown-username">{displayName}</div>
                        <div className="dropdown-email">{user.email}</div>
                      </div>
                    </div>
                    <div className="dropdown-divider"></div>
                    <button className="dropdown-item" onClick={() => {
                      setShowUserMenu(false);
                      navigate("/settings");
                    }}>
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                      </svg>
                      Profile &amp; Settings
                    </button>
                    <button className="dropdown-item danger" onClick={handleSignOut}>
                      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                      </svg>
                      Sign Out
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <button className="btn-signin" onClick={() => navigate("/login")}>
                Sign in
              </button>
            )}
          </div>
        </header>

        {/* Page Content */}
        <div className="page-content">
          {activeTab === 'overview' && renderOverview()}
          {activeTab === 'meetings' && <MeetingsPage />}
          {activeTab === 'history' && <HistoryPage />}
          {activeTab === 'support' && <SupportPage />}
          {activeTab === 'settings' && <SettingsContent />}
        </div>
      </main>

      {/* Offered to a guest returning from a call, once. */}
      {showSignupPrompt && (
        <div className="modal-overlay" onClick={() => setShowSignupPrompt(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Thanks for joining</h2>
              <button className="modal-close" onClick={() => setShowSignupPrompt(false)}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <p className="modal-lead">
                Create an account to start your own meetings and keep a record of
                the ones you join.
              </p>
            </div>

            <div className="modal-footer">
              <button
                className="btn-cancel"
                onClick={() => setShowSignupPrompt(false)}
              >
                Not now
              </button>
              <button
                className="btn-create"
                onClick={() => navigate("/login")}
              >
                Create account
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Start Meeting Modal */}
      {showStartMeetingModal && (
        <div className="modal-overlay" onClick={() => setShowStartMeetingModal(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Start a Meeting</h2>
              <button className="modal-close" onClick={() => setShowStartMeetingModal(false)}>
                <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            <div className="modal-body">
              <div className="form-group">
                <label>Room Code</label>
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value)}
                  placeholder="Enter room code or create new"
                  className="modal-input"
                />
              </div>

              <div className="modal-options">
                <button className="option-btn" onClick={() => setRoomCode(generateRoomCode())}>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                  </svg>
                  Generate Random Code
                </button>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn-cancel" onClick={() => setShowStartMeetingModal(false)}>
                Cancel
              </button>
              <button 
                className="btn-continue" 
                onClick={handleStartMeeting}
                disabled={!roomCode.trim()}
              >
                Continue to Preview
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;