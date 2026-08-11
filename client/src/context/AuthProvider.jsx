import React, {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import * as auth from "../service/auth";

const AuthContext = createContext(null);

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside <AuthProvider>");
  }
  return ctx;
};

/**
 * Session state for the local account store.
 *
 * See service/auth.js for what this does and does not guarantee — accounts are
 * browser-local and this is a demonstration of the flow, not real auth.
 */
export const AuthProvider = ({ children }) => {
  // Read synchronously on first render so a signed-in user never sees the login
  // screen flash before the session resolves.
  const [user, setUser] = useState(() => auth.getCurrentUser());
  const [isBusy, setIsBusy] = useState(false);

  const signUp = useCallback(async (email, password) => {
    setIsBusy(true);
    try {
      const account = await auth.signUp(email, password);
      setUser(account);
      return account;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signIn = useCallback(async (email, password) => {
    setIsBusy(true);
    try {
      const account = await auth.signIn(email, password);
      setUser(account);
      return account;
    } finally {
      setIsBusy(false);
    }
  }, []);

  const signOut = useCallback(() => {
    auth.signOut();
    setUser(null);
  }, []);

  const value = useMemo(
    () => ({
      user,
      isSignedIn: Boolean(user),
      isBusy,
      signUp,
      signIn,
      signOut,
    }),
    [user, isBusy, signUp, signIn, signOut]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};
