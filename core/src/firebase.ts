import { initializeApp, getApps, FirebaseApp } from 'firebase/app';
import { initializeFirestore, Firestore, persistentLocalCache } from 'firebase/firestore';

export interface GolfCoreFirebaseConfig {
  apiKey: string;
  authDomain: string;
  projectId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId?: string;
}

const GOLF_CORE_APP_NAME = 'golf-core';

let _app: FirebaseApp | null = null;
let _db: Firestore | null = null;

export const initGolfCoreFirebase = (config: GolfCoreFirebaseConfig): Firestore => {
  if (_db) return _db;

  const existingApp = getApps().find(a => a.name === GOLF_CORE_APP_NAME);
  _app = existingApp ?? initializeApp(config, GOLF_CORE_APP_NAME);
  _db = initializeFirestore(_app, { localCache: persistentLocalCache() });
  return _db;
};

export const getGolfCoreDb = (): Firestore => {
  if (!_db) {
    throw new Error('[golf-core] Firebase not initialized. Wrap your app with <GolfCoreProvider firebaseConfig={...}>');
  }
  return _db;
};
