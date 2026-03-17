// Provider
export { GolfCoreProvider } from './contexts/GolfCoreContext';
export type { GolfCoreProviderProps } from './contexts/GolfCoreContext';

// Firebase config type — single canonical export from firebase.ts
export type { GolfCoreFirebaseConfig } from './firebase';

// Year context
export { YearProvider, useYear } from './contexts/YearContext';

// Pages
export { RankingsPage } from './pages/RankingsPage';
export { MastersPage } from './pages/MastersPage';
export { CurrentTournamentPage } from './pages/CurrentTournamentPage';

// Components
export { MastersResults } from './components/MastersResults';
export { PlayerScorecardViewer } from './components/PlayerScorecardViewer';

// Hooks
export { useAutosyncSettings } from './hooks/useAutosyncSettings';
export { useSyncLogs } from './hooks/useSyncLogs';

// Services
export { fetchAvailableGolfers } from './services/rankingService';
export { fetchPlayerScorecardFromFirestore } from './services/scorecardService';

// Types
export type {
  Golfer,
  GolfRanking,
  TournamentFieldPlayer,
  HoleScore,
  ScorecardRound,
  SyncLog,
  SyncSetting,
  AutosyncSettings,
  RoundScores,
  RoundTeeTimes,
} from './types';

// Config
export { GOLF_CORE_COLLECTIONS } from './config/collections';
