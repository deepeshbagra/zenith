import { useCallback, useEffect, useRef, useState } from "react";
import MeshSession from "../service/MeshSession";
import { useSocket } from "../context/SocketProvider";
import { useMedia } from "../context/MediaProvider";
import { useAuth } from "../context/AuthProvider";
import { getParticipantId, getDisplayName } from "../service/identity";
import { recordJoin } from "../service/history";
import { setIceServers } from "../service/iceServers";

const JOIN_ERRORS = {
  ROOM_FULL: "This room is full. Rooms hold up to 5 people.",
  INVALID_ROOM_CODE:
    "That room code isn't valid. Codes are 4-64 letters, numbers or dashes.",
  INVALID_PARTICIPANT_ID: "Could not identify this session. Try reloading.",
  INTERNAL_ERROR: "The server had a problem. Try again in a moment.",
};

/**
 * Connects to a room and keeps the mesh in sync with it.
 *
 * Owns the whole call lifecycle so Room.jsx stays a rendering concern: joining,
 * reconciling the roster, routing signalling, chat, reactions and teardown.
 *
 * @param {string} roomId
 */
export function useRoom(roomId) {
  const { socket, status: socketStatus } = useSocket();
  const { stream, isAudioMuted, isVideoOff } = useMedia();
  const { user } = useAuth();

  const [peers, setPeers] = useState([]);
  const [roster, setRoster] = useState([]);
  const [hostId, setHostId] = useState(null);
  const [joinState, setJoinState] = useState("joining");
  const [joinError, setJoinError] = useState(null);
  const [hasTurn, setHasTurn] = useState(true);
  const [messages, setMessages] = useState([]);
  const [reactions, setReactions] = useState([]);

  const sessionRef = useRef(null);
  const selfId = useRef(getParticipantId()).current;

  // Create the mesh session once per room.
  useEffect(() => {
    const session = new MeshSession({
      selfId,
      onSignal: (socketId, data) => {
        socket.emit("signal", { to: socketId, data });
      },
      onPeersChanged: setPeers,
    });
    sessionRef.current = session;

    return () => {
      session.close();
      sessionRef.current = null;
    };
  }, [socket, selfId, roomId]);

  // Keep the mesh publishing the current local stream.
  useEffect(() => {
    if (stream && sessionRef.current) {
      sessionRef.current.setLocalStream(stream);
    }
  }, [stream]);

  /**
   * Joins the room. Runs on first connect and again on every reconnect, which is
   * routine on Vercel: the function's max duration force-closes the WebSocket
   * mid-call. Rejoining with the same participant id lets peers keep their
   * established media connections rather than rebuilding them.
   */
  const join = useCallback(() => {
    if (!roomId) return;

    socket.emit(
      "room:join",
      {
        room: roomId,
        name: getDisplayName() || "Guest",
        participantId: selfId,
      },
      (response) => {
        if (!response?.ok) {
          setJoinState("error");
          setJoinError(
            JOIN_ERRORS[response?.error] || "Could not join this room."
          );
          return;
        }

        // Applied before the roster is synced, so the peer connections created
        // from it are built with the TURN credentials rather than STUN alone.
        setIceServers(response.iceServers, response.hasTurn);
        setHasTurn(Boolean(response.hasTurn));

        setJoinState("joined");
        setJoinError(null);
        setHostId(response.hostId);
        setRoster(response.participants);
        sessionRef.current?.syncParticipants(response.participants);

        // Only signed-in accounts get history — there is nothing to attach a
        // guest's entry to. recordJoin de-duplicates, so the repeated joins
        // caused by socket reconnects do not each become a row.
        if (user?.email) {
          recordJoin(user.email, roomId);
        }
      }
    );
  }, [socket, roomId, selfId, user]);

  // Join on connect, and rejoin automatically after any reconnect.
  useEffect(() => {
    if (socket.connected) join();

    socket.on("connect", join);
    return () => {
      socket.off("connect", join);
    };
  }, [socket, join]);

  // Room events.
  useEffect(() => {
    const onParticipants = ({ participants, hostId: newHostId }) => {
      setRoster(participants);
      setHostId(newHostId);
      sessionRef.current?.syncParticipants(participants);
    };

    const onSignal = ({ fromParticipantId, data }) => {
      sessionRef.current?.handleSignal(fromParticipantId, data);
    };

    const onPeerLeft = ({ participantId }) => {
      sessionRef.current?.removePeer(participantId);
    };

    const onMediaState = ({ from, audio, video }) => {
      sessionRef.current?.setPeerMediaState(from, { audio, video });
    };

    const onChatMessage = (message) => {
      setMessages((prev) => [
        ...prev,
        { ...message, id: `${message.from}-${message.timestamp}` , isOwn: message.from === selfId },
      ]);
    };

    const onReaction = ({ from, name, emoji }) => {
      const id = `${from}-${Date.now()}-${Math.random()}`;
      setReactions((prev) => [...prev, { id, from, name, emoji }]);
      setTimeout(() => {
        setReactions((prev) => prev.filter((r) => r.id !== id));
      }, 4000);
    };

    socket.on("room:participants", onParticipants);
    socket.on("signal", onSignal);
    socket.on("peer:left", onPeerLeft);
    socket.on("media:state", onMediaState);
    socket.on("chat:message", onChatMessage);
    socket.on("reaction", onReaction);

    return () => {
      socket.off("room:participants", onParticipants);
      socket.off("signal", onSignal);
      socket.off("peer:left", onPeerLeft);
      socket.off("media:state", onMediaState);
      socket.off("chat:message", onChatMessage);
      socket.off("reaction", onReaction);
    };
  }, [socket, selfId]);

  // Tell the room about mute / camera changes. WebRTC has no reliable way to
  // observe a disabled track from the other end, so it must be announced.
  useEffect(() => {
    if (joinState !== "joined") return;
    socket.emit("media:state", {
      audio: !isAudioMuted,
      video: !isVideoOff,
    });
  }, [socket, joinState, isAudioMuted, isVideoOff]);

  const sendMessage = useCallback(
    (text) => {
      if (!text.trim()) return;
      socket.emit("chat:message", { text });
    },
    [socket]
  );

  const sendReaction = useCallback(
    (emoji) => {
      socket.emit("reaction", { emoji });
    },
    [socket]
  );

  const leave = useCallback(() => {
    socket.emit("room:leave");
    sessionRef.current?.close();
  }, [socket]);

  /**
   * Swaps the outbound video track on every peer connection at once.
   * @param {MediaStreamTrack} track
   */
  const replaceVideoTrack = useCallback(async (track) => {
    await sessionRef.current?.replaceVideoTrack(track);
  }, []);

  return {
    selfId,
    peers,
    roster,
    hostId,
    isHost: hostId === selfId,
    joinState,
    joinError,
    socketStatus,
    hasTurn,
    messages,
    reactions,
    sendMessage,
    sendReaction,
    replaceVideoTrack,
    leave,
  };
}
