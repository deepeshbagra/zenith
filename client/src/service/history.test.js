import {
  getHistory,
  recordJoin,
  clearHistory,
  getHistoryStats,
} from "./history";

const EMAIL = "ada@example.com";

describe("history", () => {
  beforeEach(() => {
    localStorage.clear();
    jest.useRealTimers();
  });

  it("starts empty", () => {
    expect(getHistory(EMAIL)).toEqual([]);
    expect(getHistoryStats(EMAIL)).toEqual({
      totalMeetings: 0,
      uniqueRooms: 0,
      lastJoinedAt: null,
    });
  });

  it("records a join with a timestamp", () => {
    recordJoin(EMAIL, "abc-defg-hij");

    const entries = getHistory(EMAIL);
    expect(entries).toHaveLength(1);
    expect(entries[0].roomId).toBe("abc-defg-hij");
    expect(Number.isNaN(new Date(entries[0].joinedAt).getTime())).toBe(false);
  });

  it("lists newest first", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-05-01T10:00:00Z"));
    recordJoin(EMAIL, "first-room");

    jest.setSystemTime(new Date("2024-05-01T12:00:00Z"));
    recordJoin(EMAIL, "second-room");

    expect(getHistory(EMAIL).map((e) => e.roomId)).toEqual([
      "second-room",
      "first-room",
    ]);
  });

  it("does not add a duplicate row when rejoining the same room straight away", () => {
    // Socket reconnects re-run the join, and a refresh does too. Neither is a
    // separate meeting.
    recordJoin(EMAIL, "same-room");
    recordJoin(EMAIL, "same-room");
    recordJoin(EMAIL, "same-room");

    expect(getHistory(EMAIL)).toHaveLength(1);
  });

  it("records a genuinely separate later visit to the same room", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-05-01T10:00:00Z"));
    recordJoin(EMAIL, "standup");

    jest.setSystemTime(new Date("2024-05-02T10:00:00Z"));
    recordJoin(EMAIL, "standup");

    expect(getHistory(EMAIL)).toHaveLength(2);
  });

  it("keeps each account's history separate", () => {
    recordJoin("one@example.com", "room-one");
    recordJoin("two@example.com", "room-two");

    expect(getHistory("one@example.com").map((e) => e.roomId)).toEqual([
      "room-one",
    ]);
    expect(getHistory("two@example.com").map((e) => e.roomId)).toEqual([
      "room-two",
    ]);
  });

  it("ignores a join with no account, so guests are not logged", () => {
    recordJoin(null, "room");
    recordJoin("", "room");
    expect(getHistory(null)).toEqual([]);
  });

  it("summarises meetings and distinct rooms", () => {
    jest.useFakeTimers().setSystemTime(new Date("2024-05-01T10:00:00Z"));
    recordJoin(EMAIL, "alpha");
    jest.setSystemTime(new Date("2024-05-02T10:00:00Z"));
    recordJoin(EMAIL, "beta");
    jest.setSystemTime(new Date("2024-05-03T10:00:00Z"));
    recordJoin(EMAIL, "alpha");

    const stats = getHistoryStats(EMAIL);
    expect(stats.totalMeetings).toBe(3);
    expect(stats.uniqueRooms).toBe(2);
    expect(stats.lastJoinedAt).toBe("2024-05-03T10:00:00.000Z");
  });

  it("clears history for one account only", () => {
    recordJoin("one@example.com", "room-one");
    recordJoin("two@example.com", "room-two");

    clearHistory("one@example.com");

    expect(getHistory("one@example.com")).toEqual([]);
    expect(getHistory("two@example.com")).toHaveLength(1);
  });

  it("survives a corrupted store", () => {
    localStorage.setItem(`zenith_history:${EMAIL}`, "not json");
    expect(getHistory(EMAIL)).toEqual([]);
  });
});
