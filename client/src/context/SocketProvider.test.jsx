import React, { StrictMode } from "react";
import { render } from "@testing-library/react";
import { io } from "socket.io-client";
import { SocketProvider } from "./SocketProvider";

// Records the order of lifecycle calls so the tests can assert what state the
// socket is left in, not merely that the methods were reachable.
//
// Named with a "mock" prefix because jest.mock() is hoisted above this file's
// declarations and only permits out-of-scope references matching that prefix.
// Plain functions rather than jest.fn(), because Create React App enables
// `resetMocks`, which would strip the implementations before each test.
const mockCalls = [];

const mockSocket = {
  connected: false,
  on: () => {},
  off: () => {},
  connect: () => {
    mockCalls.push("connect");
    mockSocket.connected = true;
  },
  disconnect: () => {
    mockCalls.push("disconnect");
    mockSocket.connected = false;
  },
  close: () => {
    mockCalls.push("close");
    mockSocket.connected = false;
  },
};

jest.mock("socket.io-client", () => ({ io: jest.fn() }));

describe("SocketProvider", () => {
  beforeEach(() => {
    mockCalls.length = 0;
    mockSocket.connected = false;
    io.mockReturnValue(mockSocket);
  });

  /**
   * Regression test.
   *
   * StrictMode mounts, unmounts and remounts in development, but the socket is
   * built with useMemo, which does not re-run on that remount. An earlier
   * version closed the socket in cleanup and never reopened it, so the app was
   * left holding a permanently closed socket — every room stayed empty behind a
   * "Reconnecting…" banner that could never resolve.
   */
  it("is left connected after a StrictMode mount/unmount/remount cycle", () => {
    render(
      <StrictMode>
        <SocketProvider>
          <div>child</div>
        </SocketProvider>
      </StrictMode>
    );

    expect(mockCalls.length).toBeGreaterThan(0);
    expect(mockCalls[mockCalls.length - 1]).toBe("connect");
    expect(mockSocket.connected).toBe(true);
  });

  it("never uses close(), which would disable auto-reconnect", () => {
    render(
      <StrictMode>
        <SocketProvider>
          <div>child</div>
        </SocketProvider>
      </StrictMode>
    );

    // close() sets socket.io's manual-disconnect flag, so nothing would bring
    // the connection back on its own. disconnect() paired with an explicit
    // connect() on mount is the recoverable form.
    expect(mockCalls).not.toContain("close");
  });

  it("disconnects when the provider really unmounts", () => {
    const { unmount } = render(
      <SocketProvider>
        <div>child</div>
      </SocketProvider>
    );

    mockCalls.length = 0;
    unmount();

    expect(mockCalls).toContain("disconnect");
    expect(mockSocket.connected).toBe(false);
  });
});
