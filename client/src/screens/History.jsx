import React, { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthProvider";
import { getHistory, clearHistory } from "../service/history";
import "./History.css";

/**
 * Meetings this account has joined, with the time of each join.
 *
 * Reads from localStorage rather than a server, so it only covers this browser.
 * The empty state says so, rather than leaving someone wondering why a meeting
 * they joined on their phone is missing.
 */
const History = () => {
  const navigate = useNavigate();
  const { user } = useAuth();

  // Bumped to force a re-read after clearing.
  const [version, setVersion] = useState(0);

  const entries = useMemo(
    () => getHistory(user?.email),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user?.email, version]
  );

  const groups = useMemo(() => groupByDay(entries), [entries]);

  const handleClear = useCallback(() => {
    clearHistory(user?.email);
    setVersion((v) => v + 1);
  }, [user?.email]);

  return (
    <div className="history-content">
      <div className="history-header">
        <div>
          <h2>Meeting history</h2>
          <p>
            {entries.length === 0
              ? "Meetings you join will be listed here."
              : `${entries.length} meeting${entries.length === 1 ? "" : "s"} joined`}
          </p>
        </div>
        {entries.length > 0 && (
          <button onClick={handleClear} className="history-clear">
            Clear history
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="history-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={1.5}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
            />
          </svg>
          <h3>No meetings yet</h3>
          <p>
            Start or join a meeting and it will appear here. History is stored
            in this browser, so it won't include meetings joined elsewhere.
          </p>
        </div>
      ) : (
        <div className="history-groups">
          {groups.map((group) => (
            <section key={group.label} className="history-group">
              <h3 className="history-group-label">{group.label}</h3>
              <ul className="history-list">
                {group.entries.map((entry) => (
                  <li key={entry.id} className="history-item">
                    <div className="history-item-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                        />
                      </svg>
                    </div>

                    <div className="history-item-main">
                      <span className="history-item-room">{entry.roomId}</span>
                      <span className="history-item-meta">
                        Joined at {formatTime(entry.joinedAt)}
                      </span>
                    </div>

                    <button
                      onClick={() => navigate(`/preview/${entry.roomId}`)}
                      className="history-item-rejoin"
                    >
                      Rejoin
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
};

function formatTime(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "unknown time";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

/**
 * Buckets entries into Today / Yesterday / an explicit date, so a long list
 * stays scannable without showing the same date on every row.
 */
function groupByDay(entries) {
  const groups = [];
  let current = null;

  for (const entry of entries) {
    const label = dayLabel(entry.joinedAt);
    if (!current || current.label !== label) {
      current = { label, entries: [] };
      groups.push(current);
    }
    current.entries.push(entry);
  }

  return groups;
}

function dayLabel(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "Unknown date";

  const startOfDay = (d) =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

  const days = Math.round(
    (startOfDay(new Date()) - startOfDay(date)) / 86400000
  );

  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";

  return date.toLocaleDateString([], {
    weekday: "long",
    day: "numeric",
    month: "long",
    // Only show the year when it isn't the current one.
    year:
      date.getFullYear() === new Date().getFullYear() ? undefined : "numeric",
  });
}

export default History;
