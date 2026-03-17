import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, limit, getDocs } from 'firebase/firestore';
import { useGolfCoreDb } from '../contexts/GolfCoreContext';
import { SyncLog } from '../types';

export const useSyncLogs = (type: string) => {
  const db = useGolfCoreDb();
  const [latestLog, setLatestLog] = useState<SyncLog | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchLatestLog = async () => {
    setLoading(true);
    setError(null);
    try {
      const logsRef = collection(db, 'SyncLogs');
      const q = query(
        logsRef,
        where('type', '==', type),
        orderBy('timestamp', 'desc'),
        limit(1)
      );
      const snapshot = await getDocs(q);
      if (!snapshot.empty) {
        const docSnap = snapshot.docs[0];
        setLatestLog({ id: docSnap.id, ...docSnap.data() } as SyncLog);
      } else {
        setLatestLog(null);
      }
    } catch (err: any) {
      console.error(`[golf-core] Error fetching latest sync log for ${type}:`, err);
      setError(err.message || 'Failed to load log');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLatestLog();
    const intervalId = setInterval(fetchLatestLog, 60000);
    return () => clearInterval(intervalId);
  }, [type, db]);

  return { latestLog, loading, error, refetch: fetchLatestLog };
};
