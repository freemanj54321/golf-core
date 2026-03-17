import { useState, useEffect } from 'react';
import { doc, setDoc, onSnapshot } from 'firebase/firestore';
import { useGolfCoreDb } from '../contexts/GolfCoreContext';
import { AutosyncSettings, SyncSetting } from '../types';

const DEFAULT_SETTINGS: AutosyncSettings = {
  rankings: { enabled: false, cron: '0 0 * * 1' },
  schedule: { enabled: false, cron: '0 0 * * 1' },
  tournamentField: { enabled: false, cron: '0 0 * * *' },
  tournamentResults: { enabled: false, cron: 'every 60 minutes' },
  scorecards: { enabled: false, cron: 'every 30 minutes' },
  teeTimes: { enabled: false, cron: '0 22 * * *' },
  activeTournamentId: '',
  activeYear: new Date().getFullYear(),
  activeRound: 1,
  tournamentDetectionMode: 'manual',
};

export const useAutosyncSettings = () => {
  const db = useGolfCoreDb();
  const [settings, setSettings] = useState<AutosyncSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const docRef = doc(db, 'Settings', 'autosync');
    const unsubscribe = onSnapshot(
      docRef,
      (docSnap) => {
        if (docSnap.exists()) {
          setSettings(docSnap.data() as AutosyncSettings);
        } else {
          setDoc(docRef, DEFAULT_SETTINGS).catch(err => {
            console.error('[golf-core] Failed to initialize autosync settings', err);
          });
        }
        setLoading(false);
      },
      (err) => {
        console.error('[golf-core] Error fetching autosync settings:', err);
        setError('Failed to load settings');
        setLoading(false);
      }
    );
    return () => unsubscribe();
  }, [db]);

  const updateSettings = async (newSettings: Partial<AutosyncSettings>) => {
    setSaving(true);
    setError(null);
    try {
      await setDoc(doc(db, 'Settings', 'autosync'), newSettings, { merge: true });
    } catch (err: any) {
      console.error('[golf-core] Error saving settings:', err);
      setError(err.message || 'Failed to save settings');
    } finally {
      setSaving(false);
    }
  };

  const updateEndpoint = async (
    endpoint: keyof Omit<AutosyncSettings, 'activeTournamentId' | 'activeYear' | 'activeRound' | 'tournamentDetectionMode' | 'autoDetectedTournamentName' | 'lastAutoDetection'>,
    params: Partial<SyncSetting>
  ) => {
    const newEndpointSetting = { ...settings[endpoint], ...params };
    await updateSettings({ [endpoint]: newEndpointSetting });
  };

  return { settings, loading, error, saving, updateSettings, updateEndpoint };
};
