import { collection, query, where, getDocs } from 'firebase/firestore';
import { Firestore } from 'firebase/firestore';
import { ScorecardRound } from '../types';

export const fetchPlayerScorecardFromFirestore = async (
  db: Firestore,
  tournId: string,
  year: number,
  playerId: string
): Promise<ScorecardRound[]> => {
  const scorecardsRef = collection(db, 'Player-Scorecards');

  let q = query(
    scorecardsRef,
    where('tournId', '==', tournId),
    where('year', '==', year),
    where('playerId', '==', playerId)
  );

  let snapshot = await getDocs(q);

  if (snapshot.empty) {
    q = query(
      scorecardsRef,
      where('tournId', '==', tournId),
      where('year', '==', year.toString()),
      where('playerId', '==', playerId)
    );
    snapshot = await getDocs(q);
  }

  const rounds: ScorecardRound[] = [];
  snapshot.forEach(doc => {
    rounds.push(doc.data() as ScorecardRound);
  });

  rounds.sort((a, b) => a.roundId - b.roundId);
  return rounds;
};
