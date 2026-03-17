import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { getHeaders, GOLF_API_HOST, DEFAULT_ORG_ID, axios } from './lib/apiClient';

export interface PgaScheduleEntry {
    tournId: string;
    tournName: string;
    year: number;
    startDate: Timestamp | null;
    endDate: Timestamp | null;
    weekNumber: number | null;
    format: string;
    purse: number;
    winnersShare: number | null;
    fedexCupPoints: number | null;
    lastUpdated: Timestamp;
}

const toTimestamp = (val: unknown): Timestamp | null => {
    if (val === null || val === undefined) return null;

    if (typeof val === 'object') {
        const obj = val as Record<string, unknown>;
        if (obj.$date !== undefined) {
            return toTimestamp(obj.$date);
        }
        if (typeof (obj as any).toMillis === 'function') return val as Timestamp;
        if (typeof obj.seconds === 'number') return Timestamp.fromMillis(obj.seconds * 1000);
        const raw = obj.$numberLong ?? obj.$numberInt;
        if (raw !== undefined) {
            const n = parseInt(String(raw), 10);
            if (!isNaN(n)) return Timestamp.fromMillis(n > 9_999_999_999 ? n : n * 1000);
        }
        return null;
    }

    if (typeof val === 'number') {
        if (isNaN(val) || val === 0) return null;
        return Timestamp.fromMillis(val > 9_999_999_999 ? val : val * 1000);
    }

    if (typeof val === 'string') {
        if (!val) return null;
        if (/^\d+$/.test(val)) {
            const n = parseInt(val, 10);
            return Timestamp.fromMillis(n > 9_999_999_999 ? n : n * 1000);
        }
        const d = new Date(val);
        return isNaN(d.getTime()) ? null : Timestamp.fromDate(d);
    }

    return null;
};

export const syncPgaSchedule = async (year: string): Promise<number> => {
    const url = `https://${GOLF_API_HOST}/schedule?orgId=${DEFAULT_ORG_ID}&year=${year}`;
    const response = await axios.get(url, { headers: getHeaders() });
    const rawItems: any[] = response.data?.schedule || [];
    const numericYear = parseInt(year, 10);

    if (rawItems.length === 0) return 0;

    const db = getFirestore();
    const collectionRef = db.collection('PGA-Schedule');

    const existingSnap = await collectionRef.where('year', '==', numericYear).get();
    if (!existingSnap.empty) {
        let deleteBatch = db.batch();
        let deleteCount = 0;
        for (const docSnap of existingSnap.docs) {
            deleteBatch.delete(docSnap.ref);
            deleteCount++;
            if (deleteCount >= 450) {
                await deleteBatch.commit();
                deleteBatch = db.batch();
                deleteCount = 0;
            }
        }
        if (deleteCount > 0) await deleteBatch.commit();
    }

    let batch = db.batch();
    let operationCount = 0;
    let totalSaved = 0;

    if (rawItems.length > 0) {
        console.log('[syncPgaSchedule] First raw item sample:', JSON.stringify(rawItems[0], null, 2));
    }

    for (const item of rawItems) {
        if (!item.tournId) continue;

        const entry: PgaScheduleEntry = {
            tournId: item.tournId,
            tournName: item.name || '',
            year: numericYear,
            startDate: toTimestamp(item.date?.start),
            endDate: toTimestamp(item.date?.end),
            weekNumber: item.date?.weekNumber ? parseInt(item.date.weekNumber, 10) : null,
            format: item.format || '',
            purse: item.purse ?? 0,
            winnersShare: item.winnersShare ?? null,
            fedexCupPoints: item.fedexCupPoints ?? null,
            lastUpdated: Timestamp.now(),
        };

        const docId = `${DEFAULT_ORG_ID}-${numericYear}-${item.tournId}`;
        batch.set(collectionRef.doc(docId), entry);
        operationCount++;
        totalSaved++;

        if (operationCount >= 450) {
            await batch.commit();
            batch = db.batch();
            operationCount = 0;
        }
    }

    if (operationCount > 0) {
        await batch.commit();
    }

    return totalSaved;
};
