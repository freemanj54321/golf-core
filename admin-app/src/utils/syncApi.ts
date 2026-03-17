import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

interface SyncResponse { success: boolean; message: string; }
interface TournamentSyncRequest { tournId: string; year: number; }
interface ResultsSyncRequest { tournId: string; year: number; roundId: string | number; }

const callFn = async <T, R>(name: string, data?: T): Promise<R> => {
  const fn = httpsCallable<T, R>(functions, name);
  const result = await fn(data as T);
  return result.data;
};

const longCallFn = async <T, R>(name: string, data?: T): Promise<R> => {
  const fn = httpsCallable<T, R>(functions, name, { timeout: 540000 });
  const result = await fn(data as T);
  return result.data;
};

export const sync_rankings_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('syncRankingsNow');

export const sync_schedule_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('syncScheduleNow');

export const sync_tournament_field_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('syncTournamentFieldNow');

export const sync_tournament_results_now = (data: ResultsSyncRequest): Promise<SyncResponse> =>
  callFn<ResultsSyncRequest, SyncResponse>('syncTournamentResultsNow', data);

export const sync_tee_times_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('syncTeeTimesNow');

export const clear_tournament_results_now = (data: TournamentSyncRequest): Promise<SyncResponse> =>
  callFn<TournamentSyncRequest, SyncResponse>('clearTournamentResultsNow', data);

export const repopulate_results_now = (data: TournamentSyncRequest): Promise<SyncResponse> =>
  callFn<TournamentSyncRequest, SyncResponse>('repopulateResultsNow', data);

export const seed_scorecard_sync_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('seedScorecardSyncNow');

export const sync_scorecards_v2_now = (): Promise<SyncResponse> =>
  longCallFn<void, SyncResponse>('syncScorecardsV2Now');

export const fetch_all_scorecards_now = (): Promise<SyncResponse> =>
  longCallFn<void, SyncResponse>('fetchAllScorecardsNow');

export const detect_active_tournament_now = (): Promise<SyncResponse> =>
  callFn<void, SyncResponse>('detectActiveTournamentNow');
