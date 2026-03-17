import { getFirestore } from 'firebase-admin/firestore';
import { getHeaders, GOLF_API_HOST, DEFAULT_ORG_ID, axios } from './lib/apiClient';

export interface TournamentResult {
    tournId: string;
    year: number;
    roundId: number;
    courseId?: string;
    leaderboardRows?: any[];
    [key: string]: unknown;
}

export const fetchTournamentResults = async (tournId: string, year: string, roundId: string): Promise<TournamentResult> => {
    const url = `https://${GOLF_API_HOST}/leaderboard?orgId=${DEFAULT_ORG_ID}&tournId=${tournId}&year=${year}&roundId=${roundId}`;
    const response = await axios.get(url, { headers: getHeaders() });
    return response.data;
};

export const saveTournamentResultsInFirestore = async (results: TournamentResult): Promise<number> => {
    const db = getFirestore();

    const tournId = results.tournId;
    const year = typeof results.year === 'object' ? parseInt((results.year as any).$numberInt) : Number(results.year);
    const roundId = typeof results.roundId === 'object' ? parseInt((results.roundId as any).$numberInt) : Number(results.roundId);

    const leaderboardRows = results.leaderboardRows;
    if (!leaderboardRows) return 0;

    // Save raw API response for audit trail and repopulation
    const rawDocId = `${tournId}-${year}-R${roundId}`;
    await db.collection('raw-tournament-results').doc(rawDocId).set(
        { ...results, lastUpdated: new Date() },
        { merge: true }
    );

    const collectionRef = db.collection('Tournament-Results');

    const chunks = [];
    for (let i = 0; i < leaderboardRows.length; i += 450) {
        chunks.push(leaderboardRows.slice(i, i + 450));
    }

    let totalSaved = 0;

    for (const chunk of chunks) {
        const chunkBatch = db.batch();
        for (const player of chunk) {
            const playerId = player.playerId;
            const rounds = player.rounds || [];
            const thisRound = rounds.find((r: any) => parseInt(r.roundId?.$numberInt || r.roundId) === roundId);

            const strokes = thisRound?.strokes ? parseInt(thisRound.strokes.$numberInt || thisRound.strokes) : null;
            const teeTime = thisRound?.teeTime || null;

            const docId = `${tournId}-${year}-R${roundId}-${playerId}`;
            const docRef = collectionRef.doc(docId);

            chunkBatch.set(docRef, {
                playerId: playerId,
                firstName: player.firstName || '',
                lastName: player.lastName || '',
                position: player.position?.$numberInt ?? player.position ?? null,
                status: player.status ?? null,
                isAmateur: player.isAmateur ?? false,
                roundScore: player.currentRoundScore?.$numberInt ?? player.currentRoundScore ?? null,
                totalToPar: player.total?.$numberInt ?? player.total ?? null,
                cumulativeStrokes: player.totalStrokesFromCompletedRounds?.$numberInt ?? player.totalStrokesFromCompletedRounds ?? null,
                strokes: strokes ?? null,
                thru: player.thru?.$numberInt ?? player.thru ?? null,
                teeTime: teeTime ?? null,
                tournId,
                year,
                roundId,
                lastUpdated: new Date()
            }, { merge: true });

            totalSaved++;
        }
        await chunkBatch.commit();
    }
    return totalSaved;
};

/**
 * Clears Tournament-Results (and raw-tournament-results) for a tournament/year.
 * NOTE: Mezzters-Results cleanup is handled by the Mezzters app on receipt of
 * the results.cleared webhook event.
 */
export const clearTournamentResultsInFirestore = async (tournId: string, year: number | string): Promise<{ deletedCount: number }> => {
    const db = getFirestore();
    const numericYear = typeof year === 'string' ? parseInt(year, 10) : year;
    const stringYear = String(year);
    console.log(`Clearing results for tournament ${tournId}, year ${year}...`);

    const docsToDelete: FirebaseFirestore.DocumentReference[] = [];

    const collectDocs = async (collectionName: string, yearVal: string | number) => {
        const snap = await db.collection(collectionName)
            .where('tournId', '==', tournId)
            .where('year', '==', yearVal)
            .get();
        snap.forEach(d => docsToDelete.push(d.ref));
    };

    await collectDocs('Tournament-Results', numericYear);
    await collectDocs('Tournament-Results', stringYear);

    const seen = new Set<string>();
    const uniqueDocs = docsToDelete.filter(d => {
        if (seen.has(d.id)) return false;
        seen.add(d.id);
        return true;
    });

    let deletedCount = 0;
    for (let i = 0; i < uniqueDocs.length; i += 450) {
        const batch = db.batch();
        for (const ref of uniqueDocs.slice(i, i + 450)) {
            batch.delete(ref);
            deletedCount++;
        }
        await batch.commit();
    }

    console.log(`Cleared ${deletedCount} Tournament-Results records for tournament ${tournId}.`);
    return { deletedCount };
};

export const repopulateFromRawResultsInFirestore = async (tournId: string, year: number | string): Promise<{ createdCount: number }> => {
    const db = getFirestore();
    const numericYear = typeof year === 'string' ? parseInt(year, 10) : year;
    const stringYear = String(year);
    console.log(`Repopulating results from raw data for tournament ${tournId}, year ${year}...`);

    let rawSnap = await db.collection('raw-tournament-results')
        .where('tournId', '==', tournId)
        .where('year', '==', stringYear)
        .get();

    if (rawSnap.empty) {
        rawSnap = await db.collection('raw-tournament-results')
            .where('tournId', '==', tournId)
            .where('year', '==', numericYear)
            .get();
    }

    if (rawSnap.empty) {
        console.warn(`No raw-tournament-results found for tournament ${tournId}, year ${year}.`);
        return { createdCount: 0 };
    }

    let totalSaved = 0;
    for (const docSnap of rawSnap.docs) {
        const rawData = docSnap.data() as TournamentResult;
        const saved = await saveTournamentResultsInFirestore(rawData);
        totalSaved += saved;
    }

    console.log(`Repopulation complete. Saved ${totalSaved} player-round records.`);
    return { createdCount: totalSaved };
};
