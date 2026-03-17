import React, { createContext, useContext, useState, useEffect, useRef, ReactNode } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { useGolfCoreDb } from './GolfCoreContext';

interface YearContextType {
  year: number;
  setYear: (year: number) => void;
  availableYears: number[];
}

const YearContext = createContext<YearContextType | undefined>(undefined);

interface YearProviderProps {
  children: ReactNode;
}

const AVAILABLE_YEARS = [2026, 2025, 2024, 2023, 2022, 2021];

const getDefaultYear = (): number => {
  const now = new Date().getFullYear();
  return AVAILABLE_YEARS.includes(now) ? now : AVAILABLE_YEARS[0];
};

export const YearProvider: React.FC<YearProviderProps> = ({ children }) => {
  const db = useGolfCoreDb();
  const [year, setYearState] = useState<number>(getDefaultYear);
  const initialised = useRef(false);

  useEffect(() => {
    const settingsDoc = doc(db, 'Settings', 'autosync');
    const unsubscribe = onSnapshot(
      settingsDoc,
      (snap) => {
        if (!initialised.current) {
          const serverYear = snap.exists() ? (snap.data().activeYear as number | undefined) : undefined;
          if (serverYear && AVAILABLE_YEARS.includes(serverYear)) {
            setYearState(serverYear);
          }
          initialised.current = true;
        }
      },
      (err) => {
        console.warn('[golf-core] YearContext: could not read Settings/autosync, using default year', err);
        initialised.current = true;
      }
    );
    return () => unsubscribe();
  }, [db]);

  const setYear = (newYear: number) => {
    if (!AVAILABLE_YEARS.includes(newYear)) {
      console.warn(`[golf-core] Year ${newYear} is not in available years`);
      return;
    }
    setYearState(newYear);
    setDoc(doc(db, 'Settings', 'autosync'), { activeYear: newYear }, { merge: true }).catch((err) => {
      console.error('[golf-core] YearContext: failed to persist year to Firestore', err);
    });
  };

  return (
    <YearContext.Provider value={{ year, setYear, availableYears: AVAILABLE_YEARS }}>
      {children}
    </YearContext.Provider>
  );
};

export const useYear = (): YearContextType => {
  const context = useContext(YearContext);
  if (context === undefined) {
    throw new Error('[golf-core] useYear must be used within a YearProvider');
  }
  return context;
};

export default YearContext;
