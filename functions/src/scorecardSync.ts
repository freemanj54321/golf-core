import { getFirestore } from 'firebase-admin/firestore';
import type { PlayerTeeTime } from './tournamentField';

export interface ScorecardSyncEntry {
    playerId: string;
    tournId: string;
    year: number;
    roundId: number;
    teeTime: string | null;
    roundComplete: boolean;
    lastCheck: FirebaseFirestore.Timestamp | null;
    nextCheck: FirebaseFirestore.Timestamp | null;
}

export const saveScorecardSyncEntries = async (
    players: PlayerTeeTime[],
    tournId: string,
    year: number
): Promise<number> => {
    const db = getFirestore();
    const collectionRef = db.collection('Scorecard-Sync');
    let batch = db.batch();
    let operationCount = 0;
    let count = 0;

    for (const player of players) {
        for (const teeEntry of player.teeTimes) {
            if (!teeEntry.roundId || isNaN(teeEntry.roundId)) continue;
            const docId = `${year}-${tournId}-${player.playerId}-${teeEntry.roundId}`;
            batch.set(collectionRef.doc(docId), {
                playerId: player.playerId,
                tournId,
                year,
                roundId: teeEntry.roundId,
                teeTime: teeEntry.teeTime || null,
                roundComplete: false,
                lastCheck: null,
                nextCheck: null,
            }, { mergeFields: ['playerId', 'tournId', 'year', 'roundId', 'teeTime'] });
            count++;
            operationCount++;
            if (operationCount >= 450) {
                await batch.commit();
                batch = db.batch();
                operationCount = 0;
            }
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }
    return count;
};

export const initializeScorecardSyncEntries = async (
    players: PlayerTeeTime[],
    tournId: string,
    year: number
): Promise<number> => {
    const db = getFirestore();
    const collectionRef = db.collection('Scorecard-Sync');
    let batch = db.batch();
    let operationCount = 0;
    let count = 0;

    for (const player of players) {
        for (const teeEntry of player.teeTimes) {
            if (!teeEntry.roundId || isNaN(teeEntry.roundId)) continue;
            const docId = `${year}-${tournId}-${player.playerId}-${teeEntry.roundId}`;
            batch.set(collectionRef.doc(docId), {
                playerId: player.playerId,
                tournId,
                year,
                roundId: teeEntry.roundId,
                teeTime: teeEntry.teeTime || null,
                roundComplete: false,
                lastCheck: null,
                nextCheck: null,
            }, { merge: true });
            count++;
            operationCount++;
            if (operationCount >= 450) {
                await batch.commit();
                batch = db.batch();
                operationCount = 0;
            }
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }
    return count;
};

export const populateScorecardSyncFromTeeTimes = async (
    tournId: string,
    year: number
): Promise<{ createdCount: number; updatedCount: number }> => {
    const db = getFirestore();

    const teeTimesSnapshot = await db.collection('TeeTimes')
        .where('tournId', '==', tournId)
        .where('year', '==', year)
        .get();

    if (teeTimesSnapshot.empty) {
        return { createdCount: 0, updatedCount: 0 };
    }

    const existingSnapshot = await db.collection('Scorecard-Sync')
        .where('tournId', '==', tournId)
        .where('year', '==', year)
        .get();

    const existingComplete = new Set<string>();
    const existingMissingDefaults = new Set<string>();

    for (const doc of existingSnapshot.docs) {
        const docData = doc.data();
        if ('roundComplete' in docData) {
            existingComplete.add(doc.id);
        } else {
            existingMissingDefaults.add(doc.id);
        }
    }

    const syncCollectionRef = db.collection('Scorecard-Sync');
    let batch = db.batch();
    let operationCount = 0;
    let createdCount = 0;
    let updatedCount = 0;

    for (const teeTimesDoc of teeTimesSnapshot.docs) {
        const data = teeTimesDoc.data();
        const playerId = String(data.playerId ?? '');
        const teeTimes: any[] = Array.isArray(data.teeTimes) ? data.teeTimes : [];

        if (!playerId) continue;

        for (const entry of teeTimes) {
            const roundId = typeof entry.roundId === 'number' ? entry.roundId : parseInt(entry.roundId, 10);
            if (!roundId || isNaN(roundId)) continue;

            const docId = `${year}-${tournId}-${playerId}-${roundId}`;
            const docRef = syncCollectionRef.doc(docId);
            const teeTime: string | null = entry.teeTime || null;
            const teeTimeTimestamp: number | null = entry.teeTimeTimestamp ?? null;

            if (existingComplete.has(docId)) {
                batch.set(docRef, { playerId, tournId, year, roundId, teeTime, teeTimeTimestamp },
                    { mergeFields: ['playerId', 'tournId', 'year', 'roundId', 'teeTime', 'teeTimeTimestamp'] });
                updatedCount++;
            } else {
                batch.set(docRef, {
                    playerId,
                    tournId,
                    year,
                    roundId,
                    teeTime,
                    teeTimeTimestamp,
                    roundComplete: false,
                    lastCheck: null,
                    nextCheck: null,
                }, { merge: true });
                if (existingMissingDefaults.has(docId)) {
                    updatedCount++;
                } else {
                    createdCount++;
                }
            }

            operationCount++;
            if (operationCount >= 450) {
                await batch.commit();
                batch = db.batch();
                operationCount = 0;
            }
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }

    return { createdCount, updatedCount };
};

export const updateScorecardSyncEntry = async (
    docId: string,
    roundComplete: boolean,
    nextCheckMs: number
): Promise<void> => {
    const db = getFirestore();
    const now = new Date();
    await db.collection('Scorecard-Sync').doc(docId).set({
        lastCheck: now,
        nextCheck: new Date(now.getTime() + nextCheckMs),
        roundComplete,
    }, { mergeFields: ['lastCheck', 'nextCheck', 'roundComplete'] });
};
