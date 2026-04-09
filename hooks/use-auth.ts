"use client";

import { useEffect, useMemo, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInWithEmailAndPassword,
  signOut,
  type User
} from "firebase/auth";
import { getFirebaseAuth, isFirebaseConfigured } from "@/lib/firebase";

type AuthMode = "signin" | "signup";

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const authEnabled = useMemo(() => isFirebaseConfigured(), []);

  useEffect(() => {
    if (!authEnabled) {
      setReady(true);
      return;
    }

    const auth = getFirebaseAuth();
    if (!auth) {
      setReady(true);
      return;
    }

    const unsubscribe = onAuthStateChanged(
      auth,
      (nextUser) => {
        setUser(nextUser);
        setError(null);
        setReady(true);
      },
      (nextError) => {
        setError(nextError.message);
        setReady(true);
      }
    );

    return unsubscribe;
  }, [authEnabled]);

  async function submit(email: string, password: string, mode: AuthMode) {
    const auth = getFirebaseAuth();
    if (!auth) {
      throw new Error("Firebase Auth is not configured.");
    }
    setError(null);
    if (mode === "signup") {
      await createUserWithEmailAndPassword(auth, email, password);
      return;
    }
    await signInWithEmailAndPassword(auth, email, password);
  }

  async function logout() {
    const auth = getFirebaseAuth();
    if (!auth) return;
    await signOut(auth);
  }

  return {
    user,
    ready,
    error,
    authEnabled,
    signIn: (email: string, password: string) => submit(email, password, "signin"),
    signUp: (email: string, password: string) => submit(email, password, "signup"),
    logout
  };
}
