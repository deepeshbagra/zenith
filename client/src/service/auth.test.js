import {
  signUp,
  signIn,
  signOut,
  getCurrentUser,
  normalizeEmail,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from "./auth";

const EMAIL = "Ada@Example.com";
const PASSWORD = "correct horse battery";

describe("auth", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("signs a new account in immediately", async () => {
    const account = await signUp(EMAIL, PASSWORD);

    expect(account.email).toBe("ada@example.com");
    expect(getCurrentUser()).toMatchObject({ email: "ada@example.com" });
  });

  it("never writes the password to storage", async () => {
    await signUp(EMAIL, PASSWORD);

    // The whole account store, whatever shape it has, must not contain the
    // password anywhere. This is the property that matters most in this file.
    const everything = JSON.stringify(localStorage);
    expect(everything).not.toContain(PASSWORD);
  });

  it("stores a salt and a derived hash, not the raw input", async () => {
    await signUp(EMAIL, PASSWORD);

    const accounts = JSON.parse(localStorage.getItem("zenith_accounts"));
    const account = accounts["ada@example.com"];

    expect(account.salt).toEqual(expect.any(String));
    expect(account.hash).toEqual(expect.any(String));
    expect(account.hash).not.toBe(PASSWORD);
    expect(account.iterations).toBeGreaterThanOrEqual(200000);
  });

  it("gives two accounts with the same password different hashes", async () => {
    await signUp("one@example.com", PASSWORD);
    await signUp("two@example.com", PASSWORD);

    const accounts = JSON.parse(localStorage.getItem("zenith_accounts"));

    // Different random salts, so identical passwords must not collide — this is
    // what stops one cracked hash from revealing every reused password.
    expect(accounts["one@example.com"].salt).not.toBe(
      accounts["two@example.com"].salt
    );
    expect(accounts["one@example.com"].hash).not.toBe(
      accounts["two@example.com"].hash
    );
  });

  it("signs in again with the same password", async () => {
    await signUp(EMAIL, PASSWORD);
    signOut();
    expect(getCurrentUser()).toBeNull();

    const account = await signIn(EMAIL, PASSWORD);
    expect(account.email).toBe("ada@example.com");
    expect(getCurrentUser()).not.toBeNull();
  });

  it("accepts the email in any casing or with surrounding space", async () => {
    await signUp(EMAIL, PASSWORD);
    signOut();

    await expect(signIn("  ADA@EXAMPLE.COM  ", PASSWORD)).resolves.toMatchObject(
      { email: "ada@example.com" }
    );
  });

  it("rejects the wrong password", async () => {
    await signUp(EMAIL, PASSWORD);
    signOut();

    await expect(signIn(EMAIL, "not the password")).rejects.toThrow(
      /incorrect/i
    );
    expect(getCurrentUser()).toBeNull();
  });

  it("does not reveal whether an email is registered", async () => {
    await signUp(EMAIL, PASSWORD);

    const wrongPassword = await signIn(EMAIL, "wrong").catch((e) => e.message);
    const noSuchUser = await signIn("nobody@example.com", "wrong").catch(
      (e) => e.message
    );

    expect(wrongPassword).toBe(noSuchUser);
  });

  it("refuses a duplicate email", async () => {
    await signUp(EMAIL, PASSWORD);
    await expect(signUp("ada@example.com", PASSWORD)).rejects.toThrow(
      /already exists/i
    );
  });

  it("refuses a short password", async () => {
    const short = "a".repeat(MIN_PASSWORD_LENGTH - 1);
    await expect(signUp(EMAIL, short)).rejects.toThrow(/at least/i);
  });

  it("refuses an invalid email", async () => {
    await expect(signUp("not-an-email", PASSWORD)).rejects.toThrow(/valid email/i);
  });

  it("drops a session pointing at a deleted account", async () => {
    await signUp(EMAIL, PASSWORD);
    localStorage.removeItem("zenith_accounts");

    expect(getCurrentUser()).toBeNull();
  });

  describe("helpers", () => {
    it("normalizes email", () => {
      expect(normalizeEmail("  Ada@Example.COM ")).toBe("ada@example.com");
      expect(normalizeEmail(undefined)).toBe("");
    });

    it("validates email shape", () => {
      expect(isValidEmail("ada@example.com")).toBe(true);
      expect(isValidEmail("ada@example")).toBe(false);
      expect(isValidEmail("ada example.com")).toBe(false);
      expect(isValidEmail("")).toBe(false);
    });
  });
});
