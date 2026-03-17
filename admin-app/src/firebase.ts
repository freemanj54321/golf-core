import { initializeApp, FirebaseApp } from 'firebase/app';
import { initializeFirestore, Firestore, persistentLocalCache } from 'firebase/firestore';
import { getAuth, Auth } from 'firebase/auth';
import { getFunctions, Functions } from 'firebase/functions';

const getFirebaseConfig = () => {
  const env = (import.meta as any).env;
  return {
    apiKey: env?.VITE_FIREBASE_API_KEY || '',
    authDomain: env?.VITE_FIREBASE_AUTH_DOMAIN || '',
    projectId: env?.VITE_FIREBASE_PROJECT_ID || '',
    storageBucket: env?.VITE_FIREBASE_STORAGE_BUCKET || '',
    messagingSenderId: env?.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: env?.VITE_FIREBASE_APP_ID || '',
  };
};

const app: FirebaseApp = initializeApp(getFirebaseConfig());
export const db: Firestore = initializeFirestore(app, { localCache: persistentLocalCache() });
export const auth: Auth = getAuth(app);
export const functions: Functions = getFunctions(app);
export { app };
