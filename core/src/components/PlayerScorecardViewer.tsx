import React, { useState, useEffect } from 'react';
import { useGolfCoreDb } from '../contexts/GolfCoreContext';
import { fetchPlayerScorecardFromFirestore } from '../services/scorecardService';
import { ScorecardRound, HoleScore } from '../types';
import { X, ChevronLeft, ChevronRight, Loader2 } from 'lucide-react';

interface PlayerScorecardViewerProps {
  playerId: string;
  tournId: string;
  year: number;
  playerName: string;
  onClose: () => void;
  roundTeeTimes?: Record<string, string | null>;
}

export const PlayerScorecardViewer: React.FC<PlayerScorecardViewerProps> = ({
  playerId, tournId, year, playerName, onClose, roundTeeTimes
}) => {
  const db = useGolfCoreDb();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [rounds, setRounds] = useState<ScorecardRound[]>([]);
  const [activeRoundIndex, setActiveRoundIndex] = useState(0);

  useEffect(() => {
    const fetchScorecards = async () => {
      setLoading(true);
      setError(null);
      try {
        const fetchedRounds = await fetchPlayerScorecardFromFirestore(db, tournId, year, playerId);
        fetchedRounds.sort((a, b) => a.roundId - b.roundId);
        setRounds(fetchedRounds);
        if (fetchedRounds.length > 0) setActiveRoundIndex(fetchedRounds.length - 1);
      } catch (err) {
        console.error('[golf-core] Error fetching scorecards:', err);
        setError('Failed to load scorecard data. Please try again later.');
      } finally {
        setLoading(false);
      }
    };
    fetchScorecards();
  }, [tournId, year, playerId, db]);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  const getScoreColor = (score: number, par: number) => {
    if (!score) return '';
    const diff = score - par;
    if (diff < -1) return 'bg-yellow-100 text-yellow-800 font-bold border-yellow-300';
    if (diff === -1) return 'bg-red-50 text-red-700 font-bold border-red-200';
    if (diff === 0) return 'bg-white text-gray-700 font-medium';
    if (diff === 1) return 'bg-blue-50 text-blue-800 border-blue-200';
    return 'bg-gray-100 text-gray-800 font-medium border-gray-300';
  };

  const renderHalf = (round: ScorecardRound, startHole: number, endHole: number, title: string) => {
    const holes = [];
    let totalScore = 0;
    let totalPar = 0;
    for (let i = startHole; i <= endHole; i++) {
      const holeData: HoleScore | undefined = round.holes[i.toString()];
      const par = holeData?.par || 4;
      const score = holeData?.holeScore;
      totalPar += par;
      if (score) totalScore += score;
      holes.push({ holeId: i, par, score });
    }
    return (
      <div className="mb-6 overflow-x-auto">
        <table className="w-full text-sm text-center border-collapse">
          <thead>
            <tr className="bg-gray-900 text-white">
              <th className="py-2 px-3 border border-gray-700 text-left uppercase text-xs tracking-wider w-20">{title}</th>
              {holes.map(h => <th key={h.holeId} className="py-2 px-3 border border-gray-700 w-10">{h.holeId}</th>)}
              <th className="py-2 px-3 border border-gray-700 w-12 font-bold">Total</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-gray-50 text-gray-600 border-b border-gray-200">
              <td className="py-2 px-3 font-medium text-left border border-gray-200">Par</td>
              {holes.map(h => <td key={h.holeId} className="py-2 px-3 border border-gray-200">{h.par}</td>)}
              <td className="py-2 px-3 font-bold border border-gray-200 bg-gray-100">{totalPar}</td>
            </tr>
            <tr>
              <td className="py-2 px-3 font-bold text-left border border-gray-200 bg-white">Score</td>
              {holes.map(h => (
                <td key={h.holeId} className={`py-2 px-3 border ${getScoreColor(h.score, h.par)}`}>{h.score || '-'}</td>
              ))}
              <td className="py-2 px-3 font-bold border border-gray-200 bg-white">{totalScore > 0 ? totalScore : '-'}</td>
            </tr>
          </tbody>
        </table>
      </div>
    );
  };

  const activeRound = rounds[activeRoundIndex];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-gray-900/60 backdrop-blur-sm" onClick={handleBackdropClick}>
      <div className="card w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-200 p-0">
        <div className="flex items-center justify-between p-5 border-b border-gray-100 bg-gradient-to-r from-green-800 to-green-900 text-white">
          <div>
            <h2 className="text-2xl font-black font-serif tracking-tight">{playerName}</h2>
            <p className="text-green-100/80 font-medium text-sm mt-0.5 uppercase tracking-wider">Tournament Scorecard</p>
          </div>
          <button onClick={onClose} className="p-2 text-white/70 hover:text-white hover:bg-white/10 rounded-full transition-colors" aria-label="Close scorecard">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 overflow-y-auto flex-1 bg-gray-50/50">
          {loading ? (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-10 w-10 text-green-700 animate-spin mb-4" />
              <p className="text-gray-500 font-medium">Loading scorecard data...</p>
            </div>
          ) : error ? (
            <div className="text-center py-12 px-4">
              <h3 className="text-lg font-bold text-gray-900 mb-2">Notice</h3>
              <p className="text-gray-500">{error}</p>
              <button onClick={onClose} className="mt-6 px-4 py-2 bg-gray-900 text-white rounded-lg font-medium hover:bg-gray-800 transition-colors">Close</button>
            </div>
          ) : rounds.length === 0 ? (
            <div className="text-center py-16 px-4">
              <p className="text-gray-500 text-lg">No scorecard data available for {playerName} yet.</p>
              <p className="text-gray-400 text-sm mt-2">The tournament may not have started, or data has not been synced.</p>
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center justify-between bg-white p-2 rounded-lg border border-gray-200 shadow-sm">
                <button onClick={() => setActiveRoundIndex(Math.max(0, activeRoundIndex - 1))} disabled={activeRoundIndex === 0} className="p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 rounded-md disabled:opacity-30 transition-colors">
                  <ChevronLeft size={20} />
                </button>
                <div className="flex space-x-1">
                  {rounds.map((r, idx) => (
                    <button key={r.roundId} onClick={() => setActiveRoundIndex(idx)} className={`px-4 py-1.5 text-sm font-bold rounded-md transition-colors ${idx === activeRoundIndex ? 'bg-green-700 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'}`}>
                      Round {r.roundId}
                    </button>
                  ))}
                </div>
                <button onClick={() => setActiveRoundIndex(Math.min(rounds.length - 1, activeRoundIndex + 1))} disabled={activeRoundIndex === rounds.length - 1} className="p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-900 rounded-md disabled:opacity-30 transition-colors">
                  <ChevronRight size={20} />
                </button>
              </div>
              <div className="flex justify-around items-center bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
                <div className="text-center">
                  <div className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Status</div>
                  <div className="font-medium text-gray-800">{activeRound.roundComplete ? 'Round Complete' : `Through Hole ${activeRound.currentHole || '?'}`}</div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Tee Time</div>
                  <div className="text-base font-bold text-gray-800">{roundTeeTimes?.[`r${activeRound.roundId}`] || '-'}</div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Today's Score</div>
                  <div className={`text-2xl font-black ${activeRound.currentRoundScore === 'E' || activeRound.currentRoundScore === '0' ? 'text-gray-700' : activeRound.currentRoundScore?.startsWith('-') ? 'text-red-600' : 'text-green-700'}`}>
                    {activeRound.currentRoundScore || '-'}
                  </div>
                </div>
                <div className="w-px h-10 bg-gray-200"></div>
                <div className="text-center">
                  <div className="text-xs text-gray-400 uppercase font-bold tracking-wider mb-1">Strokes</div>
                  <div className="text-xl font-bold text-gray-800">{activeRound.totalShots || '-'}</div>
                </div>
              </div>
              <div className="card shadow-sm border border-gray-200 p-1 md:p-6 overflow-hidden">
                {renderHalf(activeRound, 1, 9, 'OUT')}
                {renderHalf(activeRound, 10, 18, 'IN')}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default PlayerScorecardViewer;
