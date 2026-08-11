/**
 * Local account storage.
 *
 * ## What this is, and what it is not
 *
 * There is no backend user database in this project, so accounts live in the
 * browser's localStorage. Passwords are never stored: each account keeps a
 * random 16-byte salt and a PBKDF2-SHA256 derivation of the password, and
 * sign-in re-derives and compares. That means the stored data does not reveal
 * the password even if someone reads it.
 *
 * It is still not authentication in any meaningful sense. Anyone with access to
 * this browser profile can read, clear, or replace the account store, and
 * nothing here is verified by a server — the room itself is open to anyone with
 * the code. Treat it as a demonstration of the sign-in flow, not as a security
 * boundary. Real auth needs a server that holds the hash and issues a session
 * token the client cannot forge.
 */

const ACCOUNTS_KEY = "zenith_accounts";
const SESSION_KEY = "zenith_session";

// OWASP's floor for PBKDF2-SHA256 at time of writing. High enough to make
// offline guessing costly, low enough to stay imperceptible on sign-in.
const PBKDF2_ITERATIONS = 210000;
const KEY_LENGTH_BITS = 256;
const SALT_BYTES = 16;

export const MIN_PASSWORD_LENGTH = 8;

export class AuthError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "AuthError";
    this.code = code;
  }
}

function readAccounts() {
  try {
    const raw = localStorage.getItem(ACCOUNTS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    // Corrupted store: start clean rather than locking the user out entirely.
    return {};
  }
}

function writeAccounts(accounts) {
  localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
}

function toBase64(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)));
}

function fromBase64(value) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function requireCrypto() {
  if (!window.crypto?.subtle) {
    // subtle is only exposed in secure contexts (https or localhost).
    throw new AuthError(
      "INSECURE_CONTEXT",
      "Accounts need a secure connection. Use https, or localhost during development."
    );
  }
}

/**
 * Derives a key from a password and salt.
 * @param {string} password
 * @param {Uint8Array} salt
 * @returns {Promise<string>} base64 derivation
 */
async function derive(password, salt) {
  const encoder = new TextEncoder();

  const baseKey = await window.crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await window.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt,
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    KEY_LENGTH_BITS
  );

  return toBase64(bits);
}

/**
 * Compares two base64 strings without an early exit.
 *
 * Timing-safe comparison is not strictly meaningful here — the attacker already
 * has the stored hash if they can read localStorage — but the alternative is a
 * habit worth not forming.
 */
function constantTimeEqual(a, b) {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i += 1) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

export function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function isValidEmail(email) {
  // Deliberately permissive. Over-strict email regexes reject valid addresses,
  // and there is no confirmation step here that a stricter check would protect.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

/**
 * Creates an account and signs it in.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{email: string, createdAt: string}>}
 */
export async function signUp(email, password) {
  requireCrypto();

  const normalized = normalizeEmail(email);

  if (!isValidEmail(normalized)) {
    throw new AuthError("INVALID_EMAIL", "Enter a valid email address.");
  }
  if (!password || password.length < MIN_PASSWORD_LENGTH) {
    throw new AuthError(
      "WEAK_PASSWORD",
      `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`
    );
  }

  const accounts = readAccounts();
  if (accounts[normalized]) {
    throw new AuthError(
      "EMAIL_TAKEN",
      "An account with this email already exists on this device. Sign in instead."
    );
  }

  const salt = window.crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt);

  const account = {
    email: normalized,
    salt: toBase64(salt),
    hash,
    iterations: PBKDF2_ITERATIONS,
    createdAt: new Date().toISOString(),
  };

  accounts[normalized] = account;
  writeAccounts(accounts);
  localStorage.setItem(SESSION_KEY, normalized);

  return { email: normalized, createdAt: account.createdAt };
}

/**
 * Verifies a password and starts a session.
 * @param {string} email
 * @param {string} password
 * @returns {Promise<{email: string, createdAt: string}>}
 */
export async function signIn(email, password) {
  requireCrypto();

  const normalized = normalizeEmail(email);
  const accounts = readAccounts();
  const account = accounts[normalized];

  // One message for both "no such account" and "wrong password", so the form
  // does not confirm which emails exist.
  const failure = new AuthError(
    "INVALID_CREDENTIALS",
    "Email or password is incorrect."
  );

  if (!account) throw failure;

  const hash = await derive(password, fromBase64(account.salt));
  if (!constantTimeEqual(hash, account.hash)) throw failure;

  localStorage.setItem(SESSION_KEY, normalized);
  return { email: account.email, createdAt: account.createdAt };
}

/**
 * The signed-in account, or null.
 * @returns {{email: string, createdAt: string}|null}
 */
export function getCurrentUser() {
  const email = localStorage.getItem(SESSION_KEY);
  if (!email) return null;

  const account = readAccounts()[email];
  if (!account) {
    // Session points at an account that no longer exists.
    localStorage.removeItem(SESSION_KEY);
    return null;
  }

  return { email: account.email, createdAt: account.createdAt };
}

export function signOut() {
  localStorage.removeItem(SESSION_KEY);
}

export function hasAnyAccount() {
  return Object.keys(readAccounts()).length > 0;
}
