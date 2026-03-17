import React, { createContext, useContext, ReactNode } from 'react';
import { Firestore } from 'firebase/firestore';
import { GolfCoreFirebaseConfig, initGolfCoreFirebase } from '../firebase';

export type { GolfCoreFirebaseConfig } from '../firebase';

interface GolfCoreContextType {
  db: Firestore;
}

const GolfCoreContext = createContext<GolfCoreContextType | undefined>(undefined);

export interface GolfCoreProviderProps {
  firebaseConfig: GolfCoreFirebaseConfig;
  children: ReactNode;
}

export const GolfCoreProvider: React.FC<GolfCoreProviderProps> = ({ firebaseConfig, children }) => {
  const db = initGolfCoreFirebase(firebaseConfig);
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
