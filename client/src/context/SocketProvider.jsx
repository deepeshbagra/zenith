import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { io } from "socket.io-client";

const SocketContext = createContext(null);

export const useSocket = () => {
  const ctx = useContext(SocketContext);
  if (!ctx) {
    throw new Error("useSocket must be used inside <SocketProvider>");
  }
  return ctx;
};

/**
 * Resolves where and how to reach the signalling server.
 *
 * In production the server runs as a Vercel Function served from the same origin
 * as the app, mounted at /api/socket-io. Socket.IO appends its own "/socket.io"
 * to whatever path it is given, hence the doubled segment.
 *
 * In development it is a standalone Node process on another port, using the
 * library's default path.
 */
function resolveConnection() {
  const explicitUrl = process.env.REACT_APP_SOCKET_URL;

  if (explicitUrl) {
    return { url: explicitUrl, path: "/socket.io" };
  }

  if (process.env.NODE_ENV === "development") {
    return { url: "http://localhost:8000", path: "/socket.io" };
  }

  // Same-origin function. The path sits outside /api because Vercel will not
  // route a two-segment path to a function, and Socket.IO always appends a
  // trailing slash — see the routing note in api/socket-io/[...path].js.
  return { url: window.location.origin, path: "/rtc" };
}

export const SocketProvider = ({ children }) => {
  /**
   * The socket is built once and stored in a ref, not in useMemo.
   *
   * StrictMode double-invokes the render phase in development, and a useMemo
   * factory runs as part of render — so `io()` was being called twice. React
   * keeps only the second result, but the first socket had already connected
   * (autoConnect defaults to true) with nothing left holding a reference to
   * close it. Every mount leaked a live WebSocket.
   *
   * A ref survives the double render, so the guard below runs the factory once.
   * autoConnect is off as a second line of defence: even if a socket were built
   * and discarded, it would never open a connection. The effect below owns
   * connecting and disconnecting.
   */
  const socketRef = useRef(null);

  if (socketRef.current === null) {
    const { url, path } = resolveConnection();
    console.log(`[socket] using ${url} (path: ${path})`);

    socketRef.current = io(url, {
      path,
      autoConnect: false,
      // Required on Vercel: Socket.IO defaults to HTTP long-polling, which does
      // not work through the function's WebSocket upgrade path.
      transports: ["websocket"],
      withCredentials: true,
      reconnection: true,
      // Unlimited attempts rather than the old cap of 5. Vercel closes the
      // socket when the function hits its max duration (300s on Hobby), so a
      // long call will legitimately reconnect several times and must not give up.
      reconnectionAttempts: Infinity,
      reconnectionDelay: 500,
      reconnectionDelayMax: 5000,
      randomizationFactor: 0.5,
      timeout: 10000,
    });
  }

  const socket = socketRef.current;

  const [status, setStatus] = useState(
    socket.connected ? "connected" : "connecting"
  );

  useEffect(() => {
    const onConnect = () => setStatus("connected");
    const onDisconnect = (reason) => {
      console.log(`[socket] disconnected: ${reason}`);
      // "io server disconnect" means the server deliberately closed us and will
      // not auto-reconnect; everything else retries on its own.
      if (reason === "io server disconnect") {
        setStatus("disconnected");
        socket.connect();
      } else {
        setStatus("reconnecting");
      }
    };
    const onConnectError = (err) => {
      console.error("[socket] connection error:", err.message);
      setStatus("reconnecting");
    };

    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    socket.on("connect_error", onConnectError);

    return () => {
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
      socket.off("connect_error", onConnectError);
    };
  }, [socket]);

  /**
   * Keeps the connection tied to the provider's lifetime.
   *
   * The reconnect on mount is not redundant. In development React StrictMode
   * mounts, unmounts and remounts, but `useMemo` does not re-run on that
   * remount — so a cleanup that only disconnected would leave the app holding a
   * socket that is closed forever. `disconnect()` also clears socket.io's
   * auto-reconnect flag, so nothing would ever bring it back: the symptom is a
   * room that stays empty with a permanent "Reconnecting…" banner.
   *
   * Calling connect() on every mount makes the cycle safe, and is a no-op when
   * the socket is already connected or connecting.
   */
  useEffect(() => {
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  const value = useMemo(() => ({ socket, status }), [socket, status]);

  return (
    <SocketContext.Provider value={value}>{children}</SocketContext.Provider>
  );
};
