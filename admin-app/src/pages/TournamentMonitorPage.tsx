import React, { useState, useEffect, useCallback } from 'react';
import { Activity, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { MastersResults } from '@golf-core/components/MastersResults';
import { PlayerScorecardViewer } from '@golf-core/components/PlayerScorecardViewer';
import { useAutosyncSettings } from '@golf-core/hooks/useAutosyncSettings';
import { useSyncLogs } from '@golf-core/hooks/useSyncLogs';

// ── Helpers ───────────────────────────────────────────────────────────────────

const formatAge = (ts: any): string => {
  if (!ts) return 'Never';
  try {
    const d = ts.toDate ? ts.toDate() : ts.seconds ? new Date(ts.seconds * 1000) : new Date(ts);
    const diff = Date.now() - d.getTime();
    if (diff < 60_000) return 'Just now';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch {
    return 'Unknown';
  }
};

// ── Sync status panel ─────────────────────────────────────────────────────────

type SyncStatus = 'success' | 'error' | 'no-op' | undefined;

const statusConfig = (status: SyncStatus) => {
  switch (status) {
    case 'success': return {
      icon: <CheckCircle2 className="w-5 h-5 text-green-600" />,
      pill: 'bg-green-100 text-green-800',
      label: 'OK',
      accent: 'bg-green-500',
    };
    case 'error': return {
      icon: <XCircle className="w-5 h-5 text-red-500" />,
      pill: 'bg-red-100 text-red-700',
      label: 'Error',
      accent: 'bg-red-500',
    };
    case 'no-op': return {
      icon: <AlertCircle className="w-5 h-5 text-yellow-500" />,
      pill: 'bg-yellow-100 text-yellow-700',
      label: 'No-op',
      accent: 'bg-yellow-400',
    };
    default: return {
      icon: <Clock className="w-5 h-5 text-gray-400" />,
      pill: 'bg-gray-100 text-gray-500',
      label: 'Pending',
      accent: 'bg-gray-300',
    };
  }
};

const SyncStatusRow: React.FC<{ type: string; label: string; divider?: boolean }> = ({ type, label, divider }) => {
  const { latestLog, loading, refetch } = useSyncLogs(type);
  const cfg = statusConfig(latestLog?.status as SyncStatus);

  return (
    <div className={`flex items-start gap-4 py-4 px-5 ${divider ? 'border-t border-gray-100' : ''}`}>
      {/* accent bar */}
      <div className={`w-1 self-stretch rounded-full shrink-0 ${cfg.accent}`} />

      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          {loading
            ? <RefreshCw className="w-5 h-5 text-gray-300 animate-spin" />
            : cfg.icon}
          <span className="font-semibold text-gray-900">{label}</span>
          <span className={`ml-auto text-[11px] font-semibold px-2 py-0.5 rounded-full ${cfg.pill}`}>
            {loading ? '…' : cfg.label}
          </span>
        </div>
        <p className="text-xs text-gray-500">
          {loading ? 'Loading…' : `Last run: ${formatAge(latestLog?.timestamp)}`}
        </p>
        {!loading && latestLog?.message && (
          <p className="text-xs text-gray-400 font-mono truncate mt-0.5">{latestLog.message}</p>
        )}
      </div>

      <button
        onClick={refetch}
        title="Refresh"
        className="p-1.5 rounded-md hover:bg-gray-100 transition text-gray-400 hover:text-gray-700 shrink-0"
      >
        <RefreshCw className="w-3.5 h-3.5" />
      </button>
    </div>
  );
};

// ── Scorecard-Sync progress ───────────────────────────────────────────────────

interface RoundProgress {
  roundId: number;
  complete: number;
  total: number;
  nextCheck: Date | null;
}

const ScorecardSyncProgress: React.FC<{ tournId: string; year: number }> = ({ tournId, year }) => {
  const [rounds, setRounds] = useState<RoundProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const snap = await getDocs(
        query(collection(db, 'Scorecard-Sync'), where('tournId', '==', tournId), where('year', '==', year))
      );
      const byRound = new Map<number, { complete: number; total: number; nextChecks: Date[] }>();
      snap.forEach(d => {
        const data = d.data();
        const rid: number = typeof data.roundId === 'number' ? data.roundId : parseInt(data.roundId, 10);
        if (!byRound.has(rid)) byRound.set(rid, { complete: 0, total: 0, nextChecks: [] });
        const entry = byRound.get(rid)!;
        entry.total++;
        if (data.roundComplete) entry.complete++;
        if (data.nextCheck) {
          try {
            const nc = data.nextCheck.toDate ? data.nextCheck.toDate() : new Date(data.nextCheck.seconds * 1000);
            entry.nextChecks.push(nc);
          } catch { /* skip */ }
        }
      });
      const sorted: RoundProgress[] = Array.from(byRound.entries())
        .sort(([a], [b]) => a - b)
        .map(([roundId, { complete, total, nextChecks }]) => ({
          roundId,
          complete,
          total,
          nextCheck: nextChecks.length ? new Date(Math.min(...nextChecks.map(d => d.getTime()))) : null,
        }));
      setRounds(sorted);
    } catch { /* non-critical */ } finally {
      setLoading(false);
    }
  }, [tournId, year]);

  useEffect(() => {
    load();
    const id = setInterval(load, 60_000);
    return () => clearInterval(id);
  }, [load]);

  return (
    <div className="bg-white text-gray-900 rounded-lg shadow">
      <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-700">Scorecard Sync Progress</p>
        <button
          onClick={load}
          className="p-1.5 rounded-md hover:bg-gray-100 transition text-gray-400 hover:text-gray-700"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      <div className="px-5 py-4">
        {loading && rounds.length === 0 ? (
          <p className="text-xs text-gray-400 italic">Loading…</p>
        ) : rounds.length === 0 ? (
          <p className="text-xs text-gray-400 italic">No Scorecard-Sync entries for this tournament yet.</p>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {rounds.map(r => {
              const pct = r.total > 0 ? Math.round((r.complete / r.total) * 100) : 0;
              const allDone = r.complete === r.total && r.total > 0;
              return (
                <div key={r.roundId}>
                  <div className="flex items-baseline justify-between mb-1.5">
                    <span className="text-xs font-bold text-gray-700 uppercase tracking-wide">Round {r.roundId}</span>
                    <span className={`text-xs font-mono font-semibold ${allDone ? 'text-green-600' : 'text-gray-500'}`}>
                      {r.complete}/{r.total}
                    </span>
                  </div>
                  <div className="w-full bg-gray-100 rounded-full h-2 overflow-hidden">
                    <div
                      className={`h-2 rounded-full transition-all duration-500 ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <p className="text-[11px] mt-1 text-gray-400">
                    {allDone
                      ? '✓ Complete'
                      : r.nextCheck
                        ? `Next: ${formatAge(r.nextCheck)}`
                        : `${pct}%`}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

// ── Main page ─────────────────────────────────────────────────────────────────

const TournamentMonitorPage: React.FC = () => {
  const { settings, loading: settingsLoading } = useAutosyncSettings();
  const [selectedGolfer, setSelectedGolfer] = useState<{
    id: string;
    name: string;
    roundTeeTimes?: Record<string, string | null>;
  } | null>(null);

  if (settingsLoading) {
    return <div className="text-center py-10 font-bold text-yellow-400">Loading…</div>;
  }

  if (!settings.activeTournamentId) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-16 text-center">
        <Activity className="w-12 h-12 text-yellow-400/60 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-white mb-2">No Active Tournament</h2>
        <p className="text-green-200 text-sm">Configure an active tournament in the Auto-Sync settings.</p>
      </div>
    );
  }

  const tournamentTitle =
    settings.autoDetectedTournamentName || `Tournament ${settings.activeTournamentId}`;

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">

      {/* Page header */}
      <div className="flex items-start justify-between mb-8 pb-4 border-b border-green-700">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-green-400" />
            Tournament Monitor
          </h1>
          <p className="mt-1 text-green-200 text-sm font-medium">{tournamentTitle}</p>
          <p className="text-green-400 text-xs mt-0.5 font-mono">
            {settings.activeYear} · Round {settings.activeRound} · ID: {settings.activeTournamentId}
          </p>
        </div>
      </div>

      {/* Monitor panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">

        {/* Sync status card */}
        <div className="lg:col-span-2 bg-white text-gray-900 rounded-lg shadow">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Sync Status</p>
          </div>
          <SyncStatusRow type="tournamentResults" label="Results" />
          <SyncStatusRow type="scorecards"        label="Scorecards" divider />
          <SyncStatusRow type="teeTimes"          label="Tee Times"  divider />
        </div>

        {/* Quick stats card */}
        <div className="bg-white text-gray-900 rounded-lg shadow flex flex-col">
          <div className="px-5 py-3 border-b border-gray-100">
            <p className="text-sm font-semibold text-gray-700">Active Target</p>
          </div>
          <div className="px-5 py-4 flex flex-col gap-3 flex-1">
            <div>
              <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Tournament</p>
              <p className="text-sm font-bold text-gray-800 leading-tight">{tournamentTitle}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Year</p>
                <p className="text-lg font-black text-green-700">{settings.activeYear}</p>
              </div>
              <div>
                <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Round</p>
                <p className="text-lg font-black text-green-700">{settings.activeRound}</p>
              </div>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Tournament ID</p>
              <p className="text-sm font-mono text-gray-600">{settings.activeTournamentId}</p>
            </div>
            <div>
              <p className="text-[11px] text-gray-400 uppercase font-semibold tracking-wider mb-0.5">Detection Mode</p>
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                settings.tournamentDetectionMode === 'auto'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-gray-100 text-gray-600'
              }`}>
                {settings.tournamentDetectionMode === 'auto' ? 'Auto-detect' : 'Manual'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Scorecard progress */}
      <div className="mb-6">
        <ScorecardSyncProgress tournId={settings.activeTournamentId} year={settings.activeYear} />
      </div>

      {/* Leaderboard */}
      <MastersResults
        year={settings.activeYear}
        tournId={settings.activeTournamentId}
        title={tournamentTitle}
        onGolferClick={setSelectedGolfer}
      />

      {selectedGolfer && (
        <PlayerScorecardViewer
          playerId={selectedGolfer.id}
          playerName={selectedGolfer.name}
          tournId={settings.activeTournamentId}
          year={settings.activeYear}
          onClose={() => setSelectedGolfer(null)}
          roundTeeTimes={selectedGolfer.roundTeeTimes}
        />
      )}
    </div>
  );
};

export default TournamentMonitorPage;
