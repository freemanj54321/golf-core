import React, { createContext, useContext, ReactNode } from 'react';
import { Firestore } from 'firebase/firestore';
import { GolfCoreFirebaseConfig, initGolfCoreFirebase } from '../firebase';

export type { GolfCoreFirebaseConfig } from '../firebase';

interface GolfCoreContextType {
  db: Firestore;
}

const GolfCoreContext = createContext<GolfCoreContextType | undefined>(undefined);

export interface GolfCoreProviderProps {
  firebaseConfig?: GolfCoreFirebaseConfig;
  db?: Firestore;
  children: ReactNode;
}

export const GolfCoreProvider: React.FC<GolfCoreProviderProps> = ({ firebaseConfig, db: dbProp, children }) => {
  if (!dbProp && !firebaseConfig) {
    throw new Error('[golf-core] GolfCoreProvider requires either a db or firebaseConfig prop');
  }
  const db = dbProp ?? initGolfCoreFirebase(firebaseConfig!);
  return (
    <GolfCoreContext.Provider value={{ db }}>
      {children}
    </GolfCoreContext.Provider>
  );
};

export const useGolfCoreDb = (): Firestore => {
  const ctx = useContext(GolfCoreContext);
  if (!ctx) {
    throw new Error('[golf-core] useGolfCoreDb must be used within a GolfCoreProvider');
  }
  return ctx.db;
};
