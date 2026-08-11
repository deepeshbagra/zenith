import { getParticipantId, getDisplayName, setDisplayName } from "./identity";

describe("identity", () => {
  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
  });

  it("returns the same participant id across calls", () => {
    const first = getParticipantId();
    const second = getParticipantId();

    expect(first).toBeTruthy();
    expect(second).toBe(first);
  });

  it("stores the participant id in sessionStorage, not localStorage", () => {
    const id = getParticipantId();

    // sessionStorage is per-tab, which is what makes two tabs behave as two
    // separate participants — the usual way to test a call on one machine.
    expect(sessionStorage.getItem("zenith_participant_id")).toBe(id);
    expect(localStorage.getItem("zenith_participant_id")).toBeNull();
  });

  it("produces an id the server's validation accepts", () => {
    // Must match PARTICIPANT_ID_PATTERN in lib/signaling.js.
    expect(getParticipantId()).toMatch(/^[a-zA-Z0-9-]{8,64}$/);
  });

  it("round-trips the display name", () => {
    expect(getDisplayName()).toBe("");
    setDisplayName("Ada");
    expect(getDisplayName()).toBe("Ada");
  });
});
