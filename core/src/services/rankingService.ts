import { collection, getDocs, query, where } from 'firebase/firestore';
import { Firestore } from 'firebase/firestore';
import { Golfer } from '../types';

const unwrapValue = (val: any): any => {
  if (val && typeof val === 'object' && val.$numberInt) {
    return parseInt(val.$numberInt, 10);
  }
  return val;
};

export const fetchAvailableGolfers = async (db: Firestore, year?: number, tournamentId?: string): Promise<Golfer[]> => {
  try {
    const fieldRef = collection(db, 'Tournament-Field');
    let fieldQuery;

    if (year && tournamentId) {
      fieldQuery = query(fieldRef, where('year', '==', year), where('tournId', '==', tournamentId));
    } else if (year) {
      fieldQuery = query(fieldRef, where('year', '==', year));
    } else if (tournamentId) {
      fieldQuery = query(fieldRef, where('tournId', '==', tournamentId));
    } else {
      fieldQuery = query(fieldRef);
    }

    const fieldSnapshot = await getDocs(fieldQuery);

    if (fieldSnapshot.empty) {
      console.warn(`[golf-core] No players found in Tournament-Field${year ? ` for year ${year}` : ''}${tournamentId ? ` for tournament ${tournamentId}` : ''}.`);
      return [];
    }

    const rankingsRef = collection(db, 'golf-rankings');
    const rankingsSnapshot = await getDocs(query(rankingsRef));

    const rankMap = new Map<string, number>();
    rankingsSnapshot.docs.forEach(doc => {
      const data = doc.data();
      if (data.playerId && data.rank) {
        rankMap.set(String(unwrapValue(data.playerId)), unwrapValue(data.rank));
      }
    });

    const golfersMap = new Map<string, Golfer>();

    fieldSnapshot.docs.forEach(doc => {
      const data = doc.data();
      const fullName = data.fullName || data.name || (data.firstName && data.lastName ? `${data.firstName} ${data.lastName}` : 'Unknown');
      const playerId = String(unwrapValue(data.playerId) || doc.id);

      if (golfersMap.has(playerId)) return;

      const rank = rankMap.get(playerId) || unwrapValue(data.rank) || 999;

      golfersMap.set(playerId, {
        id: playerId,
        name: fullName,
        rank,
        country: data.country || 'USA',
        odds: data.odds || 'E',
      });
    });

    return Array.from(golfersMap.values()).sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      return a.name.localeCompare(b.name);
    });
  } catch (error) {
    console.error('[golf-core] Error fetching available golfers:', error);
    return [];
  }
};
