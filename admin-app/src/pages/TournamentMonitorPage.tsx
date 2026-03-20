import React, { useState, useEffect, useCallback } from 'react';
import { Activity, CheckCircle2, XCircle, AlertCircle, Clock, RefreshCw } from 'lucide-react';
import { collection, query, where, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { MastersResults } from '@golf-core/components/MastersResults';
import { PlayerScorecardViewer } from '@golf-core/components/PlayerScorecardViewer';
import { useAutosyncSettings } from '@golf-core/hooks/useAutosyncSettings';
import { useSyncLogs } from '@golf-core/hooks/useSyncLogs';

// ── Sync status badge ─────────────────────────────────────────────────────────

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

const StatusIcon: React.FC<{ status: string | undefined; loading: boolean }> = ({ status, loading }) => {
  if (loading) return <RefreshCw className="w-4 h-4 animate-spin text-gray-400" />;
  if (status === 'success') return <CheckCircle2 className="w-4 h-4 text-green-600" />;
  if (status === 'error') return <XCircle className="w-4 h-4 text-red-500" />;
  if (status === 'no-op') return <AlertCircle className="w-4 h-4 text-yellow-500" />;
  return <Clock className="w-4 h-4 text-gray-400" />;
};

const SyncStatusBadge: React.FC<{ type: string; label: string }> = ({ type, label }) => {
  const { latestLog, loading, refetch } = useSyncLogs(type);
  const statusColor =
    latestLog?.status === 'success' ? 'border-green-200 bg-green-50' :
    latestLog?.status === 'error'   ? 'border-red-200 bg-red-50' :
    latestLog?.status === 'no-op'   ? 'border-yellow-200 bg-yellow-50' :
    'border-gray-200 bg-gray-50';

  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 text-gray-900 ${statusColor}`}>
      <StatusIcon status={latestLog?.status} loading={loading} />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-gray-800">{label}</p>
        <p className="text-xs text-gray-500 mt-0.5">{loading ? 'Loading…' : formatAge(latestLog?.timestamp)}</p>
        {latestLog?.message && (
          <p className="text-xs text-gray-500 truncate mt-0.5 font-mono">{latestLog.message}</p>
        )}
      </div>
      <button
        onClick={refetch}
        title="Refresh"
        className="p-1 rounded hover:bg-white/60 transition text-gray-400 hover:text-gray-700"
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
  oldestNextCheck: Date | null;
}

const ScorecardSyncProgress: React.FC<{ tournId: string; year: number }> = ({ tournId, year }) => {
  const [rounds, setRounds] = useState<RoundProgress[]>([]);
  const [loading, setLoading] = useState(true);

  const fetch = useCallback(async () => {
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
          const nc = data.nextCheck.toDate ? data.nextCheck.toDate() : new Date(data.nextCheck.seconds * 1000);
          entry.nextChecks.push(nc);
        }
      });
      const sorted: RoundProgress[] = Array.from(byRound.entries())
        .sort(([a], [b]) => a - b)
        .map(([roundId, { complete, total, nextChecks }]) => ({
          roundId,
          complete,
          total,
          oldestNextCheck: nextChecks.length ? new Date(Math.min(...nextChecks.map(d => d.getTime()))) : null,
        }));
      setRounds(sorted);
    } catch {
      // non-critical
    } finally {
      setLoading(false);
    }
  }, [tournId, year]);

  useEffect(() => {
    fetch();
    const id = setInterval(fetch, 60_000);
    return () => clearInterval(id);
  }, [fetch]);

  if (loading && rounds.length === 0) return null;

  return (
    <div className="bg-white text-gray-900 rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-gray-600 uppercase tracking-wider">Scorecard-Sync Progress</p>
        <button onClick={fetch} className="p-1 rounded hover:bg-gray-100 transition text-gray-400 hover:text-gray-600">
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
        </button>
      </div>
      {rounds.length === 0 ? (
        <p className="text-xs text-gray-400 italic">No Scorecard-Sync entries found for this tournament.</p>
      ) : (
        <div className="flex flex-wrap gap-3">
          {rounds.map(r => {
            const pct = r.total > 0 ? Math.round((r.complete / r.total) * 100) : 0;
            const allDone = r.complete === r.total && r.total > 0;
            return (
              <div key={r.roundId} className="flex-1 min-w-[120px]">
                <div className="flex items-center justify-between mb-1">
                  <span className="text-xs font-bold text-gray-700">Round {r.roundId}</span>
                  <span className={`text-xs font-mono font-semibold ${allDone ? 'text-green-600' : 'text-gray-500'}`}>
                    {r.complete}/{r.total}
                  </span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1.5 overflow-hidden">
                  <div
                    className={`h-1.5 rounded-full transition-all ${allDone ? 'bg-green-500' : 'bg-blue-500'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {!allDone && r.oldestNextCheck && (
                  <p className="text-[10px] text-gray-400 mt-0.5">
                    Next: {formatAge(r.oldestNextCheck)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
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
      {/* Header */}
      <div className="flex items-center justify-between mb-6 pb-4 border-b border-green-700">
        <div>
          <h1 className="text-3xl font-bold text-white flex items-center gap-3">
            <Activity className="w-8 h-8 text-green-400" />
            Tournament Monitor
          </h1>
          <p className="mt-1 text-green-100 text-sm">
            {tournamentTitle}
            <span className="ml-2 text-green-300">
              · {settings.activeYear} · Round {settings.activeRound}
              {' · ID: '}<span className="font-mono">{settings.activeTournamentId}</span>
            </span>
          </p>
        </div>
      </div>

      {/* Sync status row */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <SyncStatusBadge type="tournamentResults" label="Results Sync" />
        <SyncStatusBadge type="scorecards" label="Scorecards Sync" />
        <SyncStatusBadge type="teeTimes" label="Tee Times Sync" />
      </div>

      {/* Scorecard-Sync progress */}
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
