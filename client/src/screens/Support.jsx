import React, { useState } from "react";
import { MAX_PARTICIPANTS } from "../service/MeshSession";
import { hasTurnConfigured } from "../service/iceServers";
import "./Support.css";

/**
 * Help page.
 *
 * Everything here describes what the app actually does. The previous version
 * advertised meeting recording, paid plans with 50-participant rooms, a Slack
 * integration, a support phone number and a 24/7 live chat — none of which
 * exist. A help page that documents imaginary features is worse than no help
 * page, because it is the one place a confused person goes to be told the truth.
 */

const TROUBLESHOOTING = [
  {
    icon: "🎥",
    title: "Camera or mic won't start",
    body: "Check the camera icon in your browser's address bar and allow access, then press Try again. If it still fails, another app may be holding the camera — close Zoom, Teams or Photo Booth and reload.",
  },
  {
    icon: "🔌",
    title: "The other person never connects",
    body: "The call needs a network path between the two of you. On restrictive networks (many offices, some mobile carriers) that path only exists via a TURN server. If one isn't configured, the tile stays on \"Connecting\" indefinitely.",
  },
  {
    icon: "🔇",
    title: "You can't hear someone",
    body: "Check whether their tile shows the muted icon — that means they muted themselves. If not, check your own system output device and volume, then have them toggle their mic off and on.",
  },
  {
    icon: "🚪",
    title: "\"This room is full\"",
    body: `Rooms hold ${MAX_PARTICIPANTS} people. Someone has to leave before another person can join, or you can start a second room.`,
  },
];

const FAQS = [
  {
    id: "capacity",
    question: "How many people can join one meeting?",
    answer: `Up to ${MAX_PARTICIPANTS}. Everyone connects directly to everyone else rather than through a media server, so each person's upload bandwidth has to carry one copy of their video per participant. That's what sets the limit — going higher would need a media server that receives each stream once and redistributes it.`,
  },
  {
    id: "invite",
    question: "How do I invite someone?",
    answer: "Open the meeting details panel during a call, or use Copy invite in the header, and send them the link. They don't need an account — they'll be asked for a display name and can join straight away.",
  },
  {
    id: "account",
    question: "Do I need an account?",
    answer: "Only to start your own meeting and to keep a record of meetings you've joined. Joining someone else's invite link never requires one.",
  },
  {
    id: "privacy",
    question: "Who can see my video?",
    answer: "Only the other people in the room. Audio and video travel directly between browsers and are encrypted in transit by WebRTC. The server only relays the small messages needed to set up each connection — it never receives, stores or forwards your media.",
  },
  {
    id: "room-access",
    question: "Can someone else join my room?",
    answer: "Yes, if they have the room code. Rooms are not restricted to invited people, so treat a room code like a password and only share it with people you want in the call.",
  },
  {
    id: "history-storage",
    question: "Where is my meeting history stored?",
    answer: "In this browser, on this device. It isn't sent to a server, which means it won't follow you to another browser or another computer, and clearing your site data erases it.",
  },
  {
    id: "accounts-storage",
    question: "How are accounts stored?",
    answer: "Also in this browser. Your password itself is never saved — only a salted PBKDF2 hash of it, which is checked when you sign in. Because there's no server involved, this isn't real account security: anyone with access to this computer's browser profile could clear or inspect that data. Please don't reuse a password you use elsewhere.",
  },
  {
    id: "screen-share",
    question: "How do I share my screen?",
    answer: "Press Present in the call controls and pick a screen, window or tab. Your camera is restored automatically when you stop sharing, whether you use the Present button or your browser's own stop-sharing bar.",
  },
  {
    id: "recording",
    question: "Can I record a meeting?",
    answer: "No. There's no recording feature, and nothing about a call is saved after everyone leaves — only the room code and the time you joined it, and only if you're signed in.",
  },
  {
    id: "reconnect",
    question: "Why did it briefly say \"Reconnecting to the room\"?",
    answer: "The signalling connection dropped and is being re-established. Video and audio keep flowing during this, because they go directly between participants rather than through the server. You only lose the ability to have someone new join until it reconnects.",
  },
  {
    id: "browsers",
    question: "Which browsers work?",
    answer: "Recent Chrome, Edge, Firefox and Safari, on desktop and mobile. The camera also requires a secure connection, so the app must be served over HTTPS — or from localhost during development.",
  },
];

const SupportPage = () => {
  const [expandedFaq, setExpandedFaq] = useState(null);

  const toggleFaq = (id) => {
    setExpandedFaq(expandedFaq === id ? null : id);
  };

  return (
    <div className="support-page">
      <div className="support-header">
        <div>
          <h1 className="page-title">Help</h1>
          <p className="page-subtitle">
            How Zenith works, and what to do when something doesn't
          </p>
        </div>
      </div>

      {/*
        Shown only when TURN is unconfigured, because in that state connection
        failures are expected rather than mysterious, and the person hitting one
        deserves to know it's a configuration gap and not their network.
      */}
      {!hasTurnConfigured() && (
        <div className="support-notice">
          <strong>No TURN server is configured.</strong> Calls will work between
          people on ordinary home networks, but will fail to connect when both
          participants are behind a restrictive network. See the project README
          for how to set one up.
        </div>
      )}

      <div className="help-topics-section">
        <h2 className="section-title">Troubleshooting</h2>
        <div className="help-topics-grid">
          {TROUBLESHOOTING.map((topic) => (
            <div key={topic.title} className="help-topic-card">
              <div className="topic-icon">
                <span className="icon-emoji">{topic.icon}</span>
              </div>
              <h3 className="topic-title">{topic.title}</h3>
              <p className="topic-description">{topic.body}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="faq-section">
        <h2 className="section-title">Frequently asked questions</h2>
        <p className="section-subtitle">
          Short, accurate answers about what this app does and doesn't do
        </p>

        <div className="faq-list">
          {FAQS.map((faq) => {
            const isOpen = expandedFaq === faq.id;
            return (
              <div
                key={faq.id}
                className={`faq-item ${isOpen ? "expanded" : ""}`}
              >
                <button
                  className="faq-question"
                  onClick={() => toggleFaq(faq.id)}
                  aria-expanded={isOpen}
                  aria-controls={`faq-answer-${faq.id}`}
                >
                  <span>{faq.question}</span>
                  <svg fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 9l-7 7-7-7"
                    />
                  </svg>
                </button>
                {isOpen && (
                  <div className="faq-answer" id={`faq-answer-${faq.id}`}>
                    <p>{faq.answer}</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default SupportPage;
