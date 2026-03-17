import { getFirestore } from 'firebase-admin/firestore';

export interface DetectedTournament {
    tournId: string;
    tournName: string;
    roundId: number;
    startDate: number;
    endDate: number;
    /** true when we're in an off-week and this is the next scheduled tournament */
    isUpcoming: boolean;
}

const toMs = (val: unknown): number => {
    if (val && typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        if (typeof (obj as any).toMillis === 'function') return (obj as any).toMillis();
        if (typeof obj.seconds === 'number') return obj.seconds * 1000;
        const raw = obj.$numberLong ?? obj.$numberInt ?? null;
        if (raw !== null) {
            const n = parseInt(String(raw), 10);
            return n > 9_999_999_999 ? n : n * 1000;
        }
    }
    const n = typeof val === 'number' ? val : parseInt(String(val), 10);
    if (isNaN(n)) return 0;
    return n > 9_999_999_999 ? n : n * 1000;
};

export const detectActiveTournament = async (year: number): Promise<DetectedTournament | null> => {
    const db = getFirestore();
    const now = Date.now();
    const MS_PER_DAY = 24 * 60 * 60 * 1000;

    const snapshot = await db.collection('PGA-Schedule').where('year', '==', year).get();
    if (snapshot.empty) return null;

    let nextUpcoming: DetectedTournament | null = null;

    for (const docSnap of snapshot.docs) {
        const data = docSnap.data();
        const startMs = toMs(data.startDate);
        const endMs = toMs(data.endDate);

        if (!startMs || !endMs) continue;

        const tournName = data.tournName || data.name || data.tournamentName || data.tournId;
        const endOfTournament = endMs + MS_PER_DAY - 1;

        if (now >= startMs && now <= endOfTournament) {
            const daysIn = Math.floor((now - startMs) / MS_PER_DAY);
            const roundId = Math.min(4, Math.max(1, daysIn + 1));
            return {
                tournId: data.tournId,
                tournName,
                roundId,
                startDate: startMs,
                endDate: endMs,
                isUpcoming: false,
            };
        }

        if (startMs > now) {
            if (!nextUpcoming || startMs < nextUpcoming.startDate) {
                nextUpcoming = {
                    tournId: data.tournId,
                    tournName,
                    roundId: 1,
                    startDate: startMs,
                    endDate: endMs,
                    isUpcoming: true,
                };
            }
        }
    }

    return nextUpcoming;
};
