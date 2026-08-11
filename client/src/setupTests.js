// jest-dom adds custom jest matchers for asserting on DOM nodes.
// allows you to do things like:
// expect(element).toHaveTextContent(/react/i)
// learn more: https://github.com/testing-library/jest-dom
import '@testing-library/jest-dom';
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// This version of jsdom omits the TextEncoder/TextDecoder globals that browsers
// have had for years. Provide them so code can use the standard API directly.
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
  globalThis.TextDecoder = TextDecoder;
}

// jsdom ships crypto.getRandomValues but not crypto.subtle, which the account
// store needs for PBKDF2. Node's WebCrypto implements the same standard API, so
// the code under test runs unmodified rather than being stubbed out.
if (!globalThis.crypto?.subtle) {
  Object.defineProperty(globalThis, 'crypto', {
    value: webcrypto,
    configurable: true,
    writable: true,
  });
}
