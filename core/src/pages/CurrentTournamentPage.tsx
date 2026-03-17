import React, { useState } from 'react';
import { MastersResults } from '../components/MastersResults';
import { PlayerScorecardViewer } from '../components/PlayerScorecardViewer';
import { useAutosyncSettings } from '../hooks/useAutosyncSettings';

export const CurrentTournamentPage: React.FC = () => {
  const { settings, loading } = useAutosyncSettings();
  const [selectedGolfer, setSelectedGolfer] = useState<{ id: string; name: string; roundTeeTimes?: Record<string, string | null> } | null>(null);

  if (loading) return <div className="text-center py-10 font-bold text-yellow-400">Loading...</div>;

  if (!settings.activeTournamentId) {
    return (
      <div className="container mx-auto px-1 sm:px-4 py-8 text-center">
        <p className="text-yellow-100 font-bold">No active tournament detected. Check Auto-Sync settings.</p>
      </div>
    );
  }

  const tournamentTitle = settings.autoDetectedTournamentName || 'Current Tournament';

  return (
    <div className="container mx-auto px-1 sm:px-4 py-4 sm:py-8 relative">
      <main>
        <MastersResults year={settings.activeYear} tournId={settings.activeTournamentId} title={tournamentTitle} onGolferClick={setSelectedGolfer} />
      </main>
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

export default CurrentTournamentPage;
