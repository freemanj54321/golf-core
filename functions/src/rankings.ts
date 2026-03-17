import { getFirestore } from 'firebase-admin/firestore';
import { getHeaders, GOLF_API_HOST, DEFAULT_ORG_ID, axios } from './lib/apiClient';

export interface WorldGolfRanking {
    playerId: string;
    firstName: string;
    lastName: string;
    fullName: string;
    rank: number;
    previousRank: number;
    totalPoints: number;
    avgPoints: number;
    pointsLost: number;
    pointsGained: number;
}

export const fetchWorldRankings = async (year: string): Promise<WorldGolfRanking[]> => {
    const url = `https://${GOLF_API_HOST}/stats?year=${year}&statId=186&orgId=${DEFAULT_ORG_ID}`;
    try {
        const response = await axios.get(url, { headers: getHeaders() });
        const data = response.data;
        return (data?.rankings || []).map((r: any) => ({
            playerId: String(r.playerId || r.playerId?.$numberInt),
            firstName: r.firstName || '',
            lastName: r.lastName || '',
            fullName: r.fullName || `${r.firstName} ${r.lastName}`.trim(),
            rank: parseInt(r.rank?.$numberInt || r.rank, 10),
            previousRank: parseInt(r.previousRank?.$numberInt || r.previousRank, 10),
            totalPoints: parseFloat(r.totalPoints?.$numberDouble || r.totalPoints),
            avgPoints: parseFloat(r.avgPoints?.$numberDouble || r.avgPoints),
            pointsLost: parseFloat(r.pointsLost?.$numberDouble || r.pointsLost),
            pointsGained: parseFloat(r.pointsGained?.$numberDouble || r.pointsGained),
        }));
    } catch (e) {
        console.error("Failed fetching rankings:", e);
        throw e;
    }
};

export const saveWorldRankingsInFirestore = async (rankings: WorldGolfRanking[], year: number): Promise<number> => {
    const db = getFirestore();
    const collectionRef = db.collection('golf-rankings');
    let batch = db.batch();
    let operationCount = 0;

    for (const ranking of rankings) {
        const docRef = collectionRef.doc(ranking.playerId);
        batch.set(docRef, { ...ranking, year, lastUpdated: new Date() }, { merge: true });
        operationCount++;
        if (operationCount >= 450) {
            await batch.commit();
            batch = db.batch();
            operationCount = 0;
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }
    return rankings.length;
};
