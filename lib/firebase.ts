import { initializeApp, getApp, getApps } from "firebase/app";
import { browserLocalPersistence, getAuth, setPersistence, type Auth } from "firebase/auth";
import { enableIndexedDbPersistence, getFirestore, type Firestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID
};

let dbInstance: Firestore | null = null;
let authInstance: Auth | null = null;
let persistenceEnabled = false;
let authPersistenceEnabled = false;

export function isFirebaseConfigured() {
  return Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);
}

export function getFirebaseApp() {
  if (!isFirebaseConfigured()) return null;
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

export function getDb() {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!dbInstance) {
    dbInstance = getFirestore(app);
  }
  if (typeof window !== "undefined" && !persistenceEnabled) {
    persistenceEnabled = true;
    enableIndexedDbPersistence(dbInstance).catch(() => undefined);
  }
  return dbInstance;
}

export function getFirebaseAuth() {
  const app = getFirebaseApp();
  if (!app) return null;
  if (!authInstance) {
    authInstance = getAuth(app);
  }
  if (typeof window !== "undefined" && !authPersistenceEnabled) {
    authPersistenceEnabled = true;
    setPersistence(authInstance, browserLocalPersistence).catch(() => undefined);
  }
  return authInstance;
}
