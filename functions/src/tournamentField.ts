import { getFirestore } from 'firebase-admin/firestore';
import { getHeaders, GOLF_API_HOST, DEFAULT_ORG_ID, axios } from './lib/apiClient';

export interface TournamentPlayer {
    playerId: string;
    firstName: string;
    lastName: string;
    country?: string;
    isAmateur?: boolean;
    [key: string]: unknown;
}

export interface TeeTimeEntry {
    roundId: number;
    teeTime: string;
    teeTimeTimestamp: string;
    startingHole: number;
}

export interface PlayerTeeTime {
    playerId: string;
    firstName: string;
    lastName: string;
    teeTimes: TeeTimeEntry[];
}

const toTeeTimesArray = (raw: unknown): any[] => {
    if (Array.isArray(raw)) return raw;
    if (raw && typeof raw === 'object') return Object.values(raw as object);
    return [];
};

const parseTeeTimeTimestamp = (raw: any): string => {
    if (!raw) return '';
    if (typeof raw === 'string') return raw;
    if (raw?.$date?.$numberLong) return new Date(Number(raw.$date.$numberLong)).toISOString();
    if (raw?.$date) return new Date(raw.$date).toISOString();
    return '';
};

export const fetchTournamentPlayers = async (tournId: string, year: string): Promise<TournamentPlayer[]> => {
    const url = `https://${GOLF_API_HOST}/tournament?orgId=${DEFAULT_ORG_ID}&tournId=${tournId}&year=${year}`;
    const response = await axios.get(url, { headers: getHeaders() });
    return response.data?.players || [];
};

export const extractTeeTimesFromPlayers = (players: TournamentPlayer[]): PlayerTeeTime[] => {
    if (players.length > 0) {
        const sample = players[0] as any;
        console.log(`[extractTeeTimesFromPlayers] First player teeTimes sample:`, (JSON.stringify(sample?.teeTimes) ?? '').slice(0, 300));
    }
    return (players as any[])
        .map(p => {
            const teeTimesArr = toTeeTimesArray(p.teeTimes);
            return { p, teeTimesArr };
        })
        .filter(({ p, teeTimesArr }) => p.playerId && teeTimesArr.length > 0)
        .map(({ p, teeTimesArr }) => ({
            playerId: String(p.playerId),
            firstName: p.firstName || '',
            lastName: p.lastName || '',
            teeTimes: teeTimesArr.map((t: any) => ({
                roundId: parseInt(t.roundId?.$numberInt ?? t.roundId, 10),
                teeTime: t.teeTime || '',
                teeTimeTimestamp: parseTeeTimeTimestamp(t.teeTimeTimestamp),
                startingHole: parseInt(t.startingHole?.$numberInt ?? t.startingHole, 10),
            })),
        }));
};

export const fetchTournamentTeeTimes = async (tournId: string, year: string): Promise<PlayerTeeTime[]> => {
    const url = `https://${GOLF_API_HOST}/tournament?orgId=${DEFAULT_ORG_ID}&tournId=${tournId}&year=${year}`;
    const response = await axios.get(url, { headers: getHeaders() });
    return extractTeeTimesFromPlayers(response.data?.players || []);
};

export const saveTeeTimesInFirestore = async (players: PlayerTeeTime[], tournId: string, year: number): Promise<number> => {
    const db = getFirestore();
    const collectionRef = db.collection('TeeTimes');
    let batch = db.batch();
    let operationCount = 0;

    for (const p of players) {
        const docId = `${year}-${tournId}-${p.playerId}`;
        batch.set(collectionRef.doc(docId), {
            playerId: p.playerId,
            firstName: p.firstName,
            lastName: p.lastName,
            tournId,
            year,
            teeTimes: p.teeTimes,
            lastUpdated: new Date(),
        }, { merge: true });
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
    return players.length;
};

export const saveTournamentPlayersInFirestore = async (players: TournamentPlayer[], tournId: string, year: number): Promise<number> => {
    const db = getFirestore();
    const collectionRef = db.collection('Tournament-Field');
    let batch = db.batch();
    let operationCount = 0;

    for (const p of players) {
        const docRef = collectionRef.doc(`${tournId}-${year}-${p.playerId}`);
        batch.set(docRef, { ...p, tournId, year, lastUpdated: new Date() }, { merge: true });
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
    return players.length;
};
