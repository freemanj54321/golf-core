import { getFirestore } from 'firebase-admin/firestore';
import { getHeaders, GOLF_API_HOST, DEFAULT_ORG_ID, axios } from './lib/apiClient';

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

export const fetchPlayerScorecard = async (tournId: string, year: string, playerId: string): Promise<ScorecardRound[]> => {
    const url = `https://${GOLF_API_HOST}/scorecard?orgId=${DEFAULT_ORG_ID}&tournId=${tournId}&year=${year}&playerId=${playerId}`;

    try {
        const response = await axios.get(url, { headers: getHeaders() });
        const data = response.data;

        if (Array.isArray(data)) return data;
        if (data?.rounds && Array.isArray(data.rounds)) return data.rounds;
        if (data?.scorecards && Array.isArray(data.scorecards)) return data.scorecards;

        console.warn(`Unexpected scorecard response shape for player ${playerId}:`, JSON.stringify(data).slice(0, 300));
        return [];
    } catch (error) {
        console.error(`Error fetching scorecard for player ${playerId}:`, error);
        throw error;
    }
};

export const updatePlayerScorecardInFirestore = async (
    tournId: string,
    year: number,
    roundId: number,
    playerId: string,
    scorecardData: ScorecardRound[]
): Promise<void> => {
    const db = getFirestore();

    const currentRoundCards = scorecardData.filter(s => {
        const apiRoundId = typeof s.roundId === 'object'
            ? parseInt((s.roundId as any).$numberInt, 10)
            : Number(s.roundId);
        return apiRoundId === roundId;
    });
    if (currentRoundCards.length === 0) {
        console.log(`Player ${playerId}: no scorecard data for round ${roundId}. API returned ${scorecardData.length} round(s): [${scorecardData.map((s: any) => {
            const rid = typeof s.roundId === 'object' ? (s.roundId as any).$numberInt : s.roundId;
            return rid;
        }).join(', ')}]`);
        return;
    }

    const roundCard = currentRoundCards[0];

    let thru: number | string = roundCard.currentHole;
    if (roundCard.roundComplete || roundCard.currentHole >= 18) {
        thru = 'F';
    } else if (roundCard.currentHole === 0 && roundCard.totalShots > 0) {
        thru = 18;
    }

    const syncDocId = `${year}-${tournId}-${playerId}-${roundId}`;
    await db.collection('Scorecard-Sync').doc(syncDocId).set({
        roundScore: roundCard.currentRoundScore,
        strokes: roundCard.totalShots,
        thru,
        playerId,
        tournId,
        year,
        roundId,
        lastScorecardSync: new Date(),
        lastUpdated: new Date()
    }, { merge: true });

    const tournResultsDocId = `${tournId}-${year}-R${roundId}-${playerId}`;
    await db.collection('Tournament-Results').doc(tournResultsDocId).set({
        playerId,
        tournId,
        year,
        roundId,
        firstName: roundCard.firstName || '',
        lastName: roundCard.lastName || '',
        roundScore: roundCard.currentRoundScore,
        strokes: roundCard.totalShots,
        thru,
        lastScorecardSync: new Date(),
        lastUpdated: new Date(),
    }, { merge: true });

    console.log(`Updated scorecard for player ${playerId} (Thru: ${thru}, Score: ${roundCard.currentRoundScore})`);

    const scorecardDocId = `${year}-${tournId}-${playerId}-${roundId}`;
    await db.collection('Player-Scorecards').doc(scorecardDocId).set({
        ...roundCard,
        year,
        lastUpdated: new Date()
    }, { merge: true });
};
