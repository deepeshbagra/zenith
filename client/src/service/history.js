/**
 * Meeting history.
 *
 * Records one entry per room a signed-in account joins, with the time they
 * joined. Guests are not recorded — there is no account to attach the entry to,
 * and quietly keeping a log against an anonymous visitor would be worse than
 * keeping none.
 *
 * Stored per account in localStorage, so it is local to this browser.
 */

const HISTORY_PREFIX = "zenith_history:";
const MAX_ENTRIES = 200;

const keyFor = (email) => `${HISTORY_PREFIX}${email}`;

/**
 * @param {string} email
 * @returns {Array<{id: string, roomId: string, joinedAt: string}>} newest first
 */
export function getHistory(email) {
  if (!email) return [];
  try {
    const raw = localStorage.getItem(keyFor(email));
    const entries = raw ? JSON.parse(raw) : [];
    return Array.isArray(entries) ? entries : [];
  } catch {
    return [];
  }
}

/**
 * Records a join.
 *
 * Rejoining the same room within a few minutes — which happens naturally when a
 * socket reconnects or someone refreshes — updates nothing rather than adding a
 * duplicate row, so the list reflects meetings rather than reconnects.
 *
 * @param {string} email
 * @param {string} roomId
 */
export function recordJoin(email, roomId) {
  if (!email || !roomId) return;

  const entries = getHistory(email);
  const now = Date.now();
  const DEDUPE_WINDOW_MS = 5 * 60 * 1000;

  const recent = entries[0];
  if (
    recent &&
    recent.roomId === roomId &&
    now - new Date(recent.joinedAt).getTime() < DEDUPE_WINDOW_MS
  ) {
    return;
  }

  const entry = {
    id: `${roomId}-${now}`,
    roomId,
    joinedAt: new Date(now).toISOString(),
  };

  const next = [entry, ...entries].slice(0, MAX_ENTRIES);
  localStorage.setItem(keyFor(email), JSON.stringify(next));
}

export function clearHistory(email) {
  if (!email) return;
  localStorage.removeItem(keyFor(email));
}

/**
 * Summary figures for the dashboard, derived from real entries.
 * @param {string} email
 */
export function getHistoryStats(email) {
  const entries = getHistory(email);

  if (entries.length === 0) {
    return { totalMeetings: 0, uniqueRooms: 0, lastJoinedAt: null };
  }

  return {
    totalMeetings: entries.length,
    uniqueRooms: new Set(entries.map((e) => e.roomId)).size,
    lastJoinedAt: entries[0].joinedAt,
  };
}
