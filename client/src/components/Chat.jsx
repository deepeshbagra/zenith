import React, { useEffect, useRef, useState } from "react";
import "./Chat.css";

/**
 * In-call chat.
 *
 * Purely presentational: messages arrive already ordered by the server and are
 * echoed back to the sender too. The previous version appended your own message
 * locally and sent it separately, so two people typing at once ended up seeing
 * the transcript in different orders.
 *
 * @param {object} props
 * @param {Array<{id: string, name: string, text: string, timestamp: string, isOwn: boolean}>} props.messages
 * @param {(text: string) => void} props.onSend
 */
const Chat = ({ messages, onSend }) => {
  const [draft, setDraft] = useState("");
  const endRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);

  // Follow new messages, but only when already near the bottom — yanking the
  // view down while someone is reading back through the history is worse than
  // missing the scroll.
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const distanceFromBottom =
      list.scrollHeight - list.scrollTop - list.clientHeight;

    // Optional call: scrollIntoView is missing in jsdom and in some older
    // engines, and failing to autoscroll should never break the panel.
    if (distanceFromBottom < 120) {
      endRef.current?.scrollIntoView?.({ behavior: "smooth", block: "nearest" });
    }
  }, [messages]);

  const handleSubmit = (e) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft("");
    inputRef.current?.focus();
  };

  return (
    <div className="chat">
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 ? (
          <div className="chat-empty">
            <p>No messages yet</p>
            <span>Messages are only visible to people in this call.</span>
          </div>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-message${message.isOwn ? " own" : ""}`}
            >
              {!message.isOwn && (
                <span className="chat-message-sender">{message.name}</span>
              )}
              <div className="chat-message-bubble">
                <span className="chat-message-text">{message.text}</span>
                <time
                  className="chat-message-time"
                  dateTime={message.timestamp}
                >
                  {formatTime(message.timestamp)}
                </time>
              </div>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-composer">
        <input
          ref={inputRef}
          type="text"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Send a message"
          className="chat-input"
          maxLength={2000}
          aria-label="Message"
        />
        <button
          type="submit"
          disabled={!draft.trim()}
          className="chat-send"
          aria-label="Send message"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8"
            />
          </svg>
        </button>
      </form>
    </div>
  );
};

function formatTime(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export default Chat;
