export interface RoundScores {
  r1?: string | number | null;
  r2?: string | number | null;
  r3?: string | number | null;
  r4?: string | number | null;
}

export interface RoundTeeTimes {
  r1?: string | null;
  r2?: string | null;
  r3?: string | null;
  r4?: string | null;
}

export interface Golfer {
  id: string;
  name: string;
  country?: string;
  rank: number;
  odds?: string;
  // Live data - optional during draft
  position?: number | string;
  status?: string | null;
  topar?: number | string;
  thru?: string;
  today?: string;
  roundScores?: RoundScores;
  roundTeeTimes?: RoundTeeTimes;
  teeTime?: string | null;
}

export interface GolfRanking {
  id: string;
  rank: number;
  fullName: string;
  country?: string;
  year: number;
  totalPoints?: number;
  rankingChange?: string;
  playerId?: string;
}

export interface TournamentFieldPlayer {
  playerId: string;
  fullName?: string;
  firstName?: string;
  lastName?: string;
  country?: string;
  rank?: number;
  tournId: string;
  year: number;
}

export interface HoleScore {
  holeId: number;
  holeScore: number;
  par: number;
}

export interface ScorecardRound {
  orgId: string;
  year: number;
  tournId: string;
  courseId: string;
  playerId: string;
  lastName: string;
  firstName: string;
  roundId: number;
  startingHole: number;
  roundComplete: boolean;
  lastUpdated: unknown;
  currentRoundScore: string;
  currentHole: number;
  holes: Record<string, HoleScore>;
  totalShots: number;
  timestamp: unknown;
}

export interface SyncLog {
  id: string;
  timestamp: Date | { seconds: number; nanoseconds: number } | any;
  type: string;
  status: 'success' | 'error' | 'no-op';
  message: string;
  tournamentId?: string;
  roundId?: number;
  details?: Record<string, unknown>;
}

export interface SyncSetting {
  enabled: boolean;
  cron: string;
  lastRun?: string;
  lastLog?: string;
}

export interface AutosyncSettings {
  rankings: SyncSetting;
  schedule: SyncSetting;
  tournamentField: SyncSetting;
  tournamentResults: SyncSetting;
  scorecards: SyncSetting;
  teeTimes: SyncSetting;
  activeTournamentId: string;
  activeYear: number;
  activeRound: number;
  tournamentDetectionMode: 'auto' | 'manual';
  autoDetectedTournamentName?: string;
  lastAutoDetection?: string;
}
