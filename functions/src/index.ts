import { onCall, onRequest, HttpsError } from "firebase-functions/v2/https";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { defineSecret } from "firebase-functions/params";

const RAPIDAPI_API_KEY = defineSecret("RAPIDAPI_API_KEY");

import { initializeApp } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import {
    fetchWorldRankings,
    saveWorldRankingsInFirestore,
} from "./rankings";
import { syncPgaSchedule } from "./schedule";
import {
    fetchTournamentPlayers,
    saveTournamentPlayersInFirestore,
    fetchTournamentTeeTimes,
    saveTeeTimesInFirestore,
    extractTeeTimesFromPlayers,
} from "./tournamentField";
import {
    fetchTournamentResults,
    saveTournamentResultsInFirestore,
    clearTournamentResultsInFirestore,
    repopulateFromRawResultsInFirestore,
} from "./leaderboard";
import {
    fetchPlayerScorecard,
    updatePlayerScorecardInFirestore,
} from "./scorecard";
import {
    initializeScorecardSyncEntries,
    saveScorecardSyncEntries,
    populateScorecardSyncFromTeeTimes,
    updateScorecardSyncEntry,
} from "./scorecardSync";
import { detectActiveTournament } from "./tournamentDetection";
import { sleep } from "./lib/apiClient";
import { fireEvent } from "./webhookService";

initializeApp();

// ---------------------------------------------------------------------------
// Tournament Detection
// ---------------------------------------------------------------------------

async function runTournamentDetection(db: Firestore, year: number): Promise<{ summary: string; details: Record<string, unknown> }> {
    const detected = await detectActiveTournament(year);
    const settingsRef = db.collection("Settings").doc("autosync");

    if (detected) {
        await settingsRef.set({
            activeTournamentId: detected.tournId,
            activeYear: year,
            activeRound: detected.roundId,
            autoDetectedTournamentName: detected.tournName,
            lastAutoDetection: new Date().toISOString(),
        }, { merge: true });

        const label = detected.isUpcoming ? "Next upcoming" : "Active";
        const summary = `${label}: ${detected.tournName} (Round ${detected.roundId}, ID: ${detected.tournId})`;
        return {
            summary,
            details: {
                tournamentId: detected.tournId,
                tournamentName: detected.tournName,
                round: detected.roundId,
                isUpcoming: detected.isUpcoming,
                startDate: new Date(detected.startDate).toISOString(),
                endDate: new Date(detected.endDate).toISOString(),
                year,
                detectedAt: new Date().toISOString(),
            }
        };
    } else {
        await settingsRef.set({
            autoDetectedTournamentName: '',
            lastAutoDetection: new Date().toISOString(),
        }, { merge: true });

        const summary = `No tournaments found in PGA-Schedule for year ${year}. Settings unchanged.`;
        return { summary, details: { year, detectedAt: new Date().toISOString() } };
    }
}

export const autosyncActiveTournament = onSchedule("0 */4 * * *", async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();

    if (settings?.tournamentDetectionMode !== "auto") {
        console.log("Tournament detection mode is manual. Skipping auto-detection.");
        return;
    }

    const year: number = new Date().getFullYear();
    console.log(`Running auto-detection for year ${year}...`);

    try {
        const { summary, details } = await runTournamentDetection(db, year);
        console.log(summary);
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentDetection", status: "success", message: summary, details });
        await fireEvent('activeTournament.updated', { year, details });
    } catch (err: any) {
        console.error("Failed to auto-detect tournament", err);
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentDetection", status: "error", message: err.message || "Failed to detect tournament.", details: { error: err.message } });
    }
});

export const detectActiveTournamentNow = onCall(async (request) => {
    if (request.auth?.token.admin !== true) {
        throw new HttpsError("permission-denied", "The function must be called by an administrator.");
    }
    const db = getFirestore();
    const year: number = new Date().getFullYear();
    try {
        const { summary, details } = await runTournamentDetection(db, year);
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentDetection", status: "success", message: `[Manual] ${summary}`, details });
        await fireEvent('activeTournament.updated', { year, details });
        return { success: true, message: summary };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to detect tournament.");
    }
});

// ---------------------------------------------------------------------------
// Rankings
// ---------------------------------------------------------------------------

export const autosyncRankings = onSchedule({ schedule: "0 0 * * 1", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings?.rankings?.enabled) { console.log("Rankings autosync is disabled."); return; }
    const { activeYear } = settings;
    if (!activeYear) return;

    const startedAt = Date.now();
    try {
        const rankings = await fetchWorldRankings(activeYear.toString());
        const count = await saveWorldRankingsInFirestore(rankings, activeYear);
        const elapsed = Date.now() - startedAt;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "rankings", status: "success", message: `Saved ${count} world rankings for ${activeYear}.`, details: { year: activeYear, rankingsReturned: rankings.length, rankingsSaved: count, elapsedMs: elapsed } });
        await fireEvent('rankings.updated', { year: activeYear });
    } catch (err: any) {
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "rankings", status: "error", message: err.message || "Failed to sync rankings.", details: { year: activeYear, error: err.message, elapsedMs: Date.now() - startedAt } });
    }
});

export const syncRankingsNow = onCall({ secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeYear) throw new HttpsError("failed-precondition", "No active year configured.");
    try {
        const rankings = await fetchWorldRankings(activeYear.toString());
        await saveWorldRankingsInFirestore(rankings, activeYear);
        const msg = `Synced ${rankings.length} world rankings for ${activeYear}.`;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "rankings", status: "success", message: `[Manual] ${msg}` });
        await fireEvent('rankings.updated', { year: activeYear });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to sync rankings.");
    }
});

// ---------------------------------------------------------------------------
// Schedule
// ---------------------------------------------------------------------------

export const autosyncSchedule = onSchedule({ schedule: "30 0 * * 1", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings?.schedule?.enabled) { console.log("Schedule autosync is disabled."); return; }
    const { activeYear } = settings;
    if (!activeYear) return;

    const startedAt = Date.now();
    try {
        const count = await syncPgaSchedule(activeYear.toString());
        const elapsed = Date.now() - startedAt;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "schedule", status: "success", message: `Saved ${count} tournaments for ${activeYear}.`, details: { year: activeYear, tournamentsSaved: count, elapsedMs: elapsed } });
        await fireEvent('schedule.updated', { year: activeYear });
    } catch (err: any) {
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "schedule", status: "error", message: err.message || "Failed to sync schedule.", details: { year: activeYear, error: err.message, elapsedMs: Date.now() - startedAt } });
    }
});

export const syncScheduleNow = onCall({ secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeYear) throw new HttpsError("failed-precondition", "No active year configured.");
    try {
        const count = await syncPgaSchedule(activeYear.toString());
        const msg = `Synced ${count} schedule entries for ${activeYear}.`;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "schedule", status: "success", message: `[Manual] ${msg}` });
        await fireEvent('schedule.updated', { year: activeYear });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to sync schedule.");
    }
});

// ---------------------------------------------------------------------------
// Tournament Field
// ---------------------------------------------------------------------------

export const autosyncTournamentField = onSchedule({ schedule: "0 0 * * *", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings?.tournamentField?.enabled) { console.log("Tournament Field autosync is disabled."); return; }
    const { activeTournamentId, activeYear } = settings;
    if (!activeTournamentId || !activeYear) return;

    const startedAt = Date.now();
    try {
        const players = await fetchTournamentPlayers(activeTournamentId, activeYear.toString());
        const count = await saveTournamentPlayersInFirestore(players, activeTournamentId, activeYear);
        const teeTimes = extractTeeTimesFromPlayers(players);
        const teeTimeCount = await saveTeeTimesInFirestore(teeTimes, activeTournamentId, activeYear);
        const syncEntryCount = await initializeScorecardSyncEntries(teeTimes, activeTournamentId, activeYear);
        const elapsed = Date.now() - startedAt;

        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentField", status: "success", message: `Saved ${count} players for ${activeTournamentId} (${activeYear}). Tee times: ${teeTimeCount}. Scorecard-Sync: ${syncEntryCount}.`, tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, playersReturned: players.length, playersSaved: count, teeTimesSaved: teeTimeCount, elapsedMs: elapsed } });
        await fireEvent('field.updated', { tournId: activeTournamentId, year: activeYear });
    } catch (err: any) {
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentField", status: "error", message: err.message || "Failed to sync tournament field.", tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, error: err.message, elapsedMs: Date.now() - startedAt } });
    }
});

export const syncTournamentFieldNow = onCall({ secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeTournamentId, activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeTournamentId || !activeYear) throw new HttpsError("failed-precondition", "No active tournament configured.");
    try {
        const players = await fetchTournamentPlayers(activeTournamentId, activeYear.toString());
        await saveTournamentPlayersInFirestore(players, activeTournamentId, activeYear);
        const teeTimes = extractTeeTimesFromPlayers(players);
        await saveTeeTimesInFirestore(teeTimes, activeTournamentId, activeYear);
        const syncCount = await initializeScorecardSyncEntries(teeTimes, activeTournamentId, activeYear);
        const msg = `Synced ${players.length} players, ${teeTimes.length} with tee times, ${syncCount} Scorecard-Sync entries (${activeTournamentId}, ${activeYear}).`;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentField", status: "success", message: `[Manual] ${msg}`, tournamentId: activeTournamentId });
        await fireEvent('field.updated', { tournId: activeTournamentId, year: activeYear });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to sync tournament field.");
    }
});

// ---------------------------------------------------------------------------
// Tee Times
// ---------------------------------------------------------------------------

export const autosyncTeeTimes = onSchedule({ schedule: "0 22 * * *", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    const { activeTournamentId, activeYear } = settings ?? {};
    if (!activeTournamentId || !activeYear) return;

    const startedAt = Date.now();
    try {
        const players = await fetchTournamentTeeTimes(activeTournamentId, activeYear.toString());
        const count = await saveTeeTimesInFirestore(players, activeTournamentId, activeYear);
        const syncCount = await saveScorecardSyncEntries(players, activeTournamentId, activeYear);
        const { createdCount, updatedCount } = await populateScorecardSyncFromTeeTimes(activeTournamentId, activeYear);
        const elapsed = Date.now() - startedAt;

        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "teeTimes", status: "success", message: `Saved tee times for ${count} players. Updated ${syncCount} Scorecard-Sync entries. Seeded ${createdCount} new / ${updatedCount} updated (${activeTournamentId}, ${activeYear}).`, tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, playersSaved: count, syncEntriesUpdated: syncCount, seedCreated: createdCount, seedUpdated: updatedCount, elapsedMs: elapsed } });
        await fireEvent('teeTimes.updated', { tournId: activeTournamentId, year: activeYear });
    } catch (err: any) {
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "teeTimes", status: "error", message: err.message || "Failed to sync tee times.", tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, error: err.message, elapsedMs: Date.now() - startedAt } });
    }
});

export const syncTeeTimesNow = onCall({ secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeTournamentId, activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeTournamentId || !activeYear) throw new HttpsError("failed-precondition", "No active tournament configured.");

    const startedAt = Date.now();
    try {
        const players = await fetchTournamentTeeTimes(activeTournamentId, activeYear.toString());
        const count = await saveTeeTimesInFirestore(players, activeTournamentId, activeYear);
        const syncCount = await saveScorecardSyncEntries(players, activeTournamentId, activeYear);
        const elapsed = Date.now() - startedAt;

        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "teeTimes", status: "success", message: `[Manual] Saved tee times for ${count} players. Updated ${syncCount} Scorecard-Sync entries (${activeTournamentId}, ${activeYear}).`, tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, playersSaved: count, syncEntriesUpdated: syncCount, elapsedMs: elapsed } });
        await fireEvent('teeTimes.updated', { tournId: activeTournamentId, year: activeYear });
        return { success: true, message: `Saved tee times for ${count} players. Updated ${syncCount} Scorecard-Sync entries.` };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to sync tee times.");
    }
});

// ---------------------------------------------------------------------------
// Tournament Results — saves to golf-core Firestore only; no Mezzters bridge
// ---------------------------------------------------------------------------

export const autosyncTournamentResults = onSchedule({ schedule: "every 60 minutes", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings?.tournamentResults?.enabled) { console.log("Tournament Results autosync is disabled."); return; }
    const { activeTournamentId, activeYear, activeRound } = settings;
    if (!activeTournamentId || !activeYear || !activeRound) return;

    const startedAt = Date.now();
    try {
        const results = await fetchTournamentResults(activeTournamentId, activeYear.toString(), activeRound.toString());
        const count = await saveTournamentResultsInFirestore(results);
        const elapsed = Date.now() - startedAt;

        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentResults", status: "success", message: `Saved ${count} player records for ${activeTournamentId} R${activeRound}.`, tournamentId: activeTournamentId, roundId: activeRound, details: { tournamentId: activeTournamentId, year: activeYear, round: activeRound, leaderboardRowsReturned: results?.leaderboardRows?.length ?? 0, playersSaved: count, elapsedMs: elapsed } });
        await fireEvent('results.updated', { tournId: activeTournamentId, year: activeYear, round: activeRound });
    } catch (err: any) {
        const is400 = err?.message?.includes("400") || err?.response?.status === 400;
        if (is400) {
            await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentResults", status: "no-op", message: `No data (400): ${activeTournamentId} R${activeRound} ${activeYear} — tournament not started or no data for this round.`, tournamentId: activeTournamentId, roundId: activeRound, details: { tournamentId: activeTournamentId, year: activeYear, round: activeRound, elapsedMs: Date.now() - startedAt } });
        } else {
            await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentResults", status: "error", message: err.message || "Failed to sync tournament results.", tournamentId: activeTournamentId, roundId: activeRound, details: { tournamentId: activeTournamentId, year: activeYear, round: activeRound, error: err.message, elapsedMs: Date.now() - startedAt } });
        }
    }
});

export const syncTournamentResultsNow = onCall({ secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { tournId, year, roundId } = (request.data ?? {}) as { tournId: string; year: number; roundId: string };
    if (!tournId || !year || !roundId) throw new HttpsError("invalid-argument", "tournId, year, and roundId are required.");
    try {
        const results = await fetchTournamentResults(tournId, year.toString(), roundId.toString());
        const saved = await saveTournamentResultsInFirestore(results);
        const msg = `Synced ${saved} player results for ${tournId} R${roundId} (${year}).`;
        const db = getFirestore();
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "tournamentResults", status: "success", message: `[Manual] ${msg}`, tournamentId: tournId });
        await fireEvent('results.updated', { tournId, year, round: Number(roundId) });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to sync tournament results.");
    }
});

export const clearTournamentResultsNow = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { tournId, year } = (request.data ?? {}) as { tournId: string; year: number };
    if (!tournId || !year) throw new HttpsError("invalid-argument", "tournId and year are required.");
    try {
        const { deletedCount } = await clearTournamentResultsInFirestore(tournId, year);
        const msg = `Cleared ${deletedCount} results records for ${tournId} (${year}).`;
        const db = getFirestore();
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "clearResults", status: "success", message: `[Manual] ${msg}`, tournamentId: tournId });
        await fireEvent('results.cleared', { tournId, year });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to clear tournament results.");
    }
});

export const repopulateResultsNow = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { tournId, year } = (request.data ?? {}) as { tournId: string; year: number };
    if (!tournId || !year) throw new HttpsError("invalid-argument", "tournId and year are required.");
    try {
        const { createdCount } = await repopulateFromRawResultsInFirestore(tournId, year);
        const msg = `Repopulated ${createdCount} player-round records for ${tournId} (${year}).`;
        const db = getFirestore();
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "repopulate", status: "success", message: `[Manual] ${msg}`, tournamentId: tournId });
        await fireEvent('results.updated', { tournId, year });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to repopulate results.");
    }
});

// ---------------------------------------------------------------------------
// Scorecards — saves to golf-core Firestore only; no Mezzters bridge
// ---------------------------------------------------------------------------

export const autosyncScorecardsV2 = onSchedule({ schedule: "every 30 minutes", secrets: [RAPIDAPI_API_KEY] }, async () => {
    const db = getFirestore();
    const settingsDoc = await db.collection("Settings").doc("autosync").get();
    if (!settingsDoc.exists) return;
    const settings = settingsDoc.data();
    if (!settings?.scorecards?.enabled) { console.log("[ScorecardsV2] Disabled."); return; }
    const { activeTournamentId, activeYear, activeRound } = settings;
    if (!activeTournamentId || !activeYear || !activeRound) return;

    const now = Date.now();
    const INTERVAL_MS = 30 * 60 * 1000;

    const teeTimesSnapshot = await db.collection("TeeTimes").where("tournId", "==", activeTournamentId).where("year", "==", activeYear).get();
    const teeTimeMap = new Map<string, number>();
    for (const teeDoc of teeTimesSnapshot.docs) {
        const data = teeDoc.data();
        const pid = String(data.playerId ?? '');
        const teeTimes: any[] = Array.isArray(data.teeTimes) ? data.teeTimes : [];
        for (const entry of teeTimes) {
            const rId = typeof entry.roundId === 'number' ? entry.roundId : parseInt(entry.roundId, 10);
            if (rId !== activeRound) continue;
            const ts = entry.teeTimeTimestamp;
            if (!ts) continue;
            const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
            if (!isNaN(ms)) teeTimeMap.set(pid, ms);
        }
    }

    const syncSnapshot = await db.collection("Scorecard-Sync").where("tournId", "==", activeTournamentId).where("year", "==", activeYear).where("roundId", "==", activeRound).get();

    const eligible: Array<{ docId: string; playerId: string }> = [];
    let skippedComplete = 0, skippedNoTeeTime = 0, skippedTeeTimeNotYet = 0;

    for (const doc of syncSnapshot.docs) {
        const d = doc.data();
        if (d.roundComplete === true) { skippedComplete++; continue; }
        const pid = String(d.playerId);
        const teeTimeMs = teeTimeMap.get(pid);
        if (teeTimeMs === undefined) { skippedNoTeeTime++; continue; }
        if (teeTimeMs > now) { skippedTeeTimeNotYet++; continue; }
        eligible.push({ docId: doc.id, playerId: pid });
    }

    let successCount = 0;
    const failedPlayerIds: string[] = [];

    for (const { docId, playerId } of eligible) {
        try {
            const scorecardData = await fetchPlayerScorecard(activeTournamentId, String(activeYear), playerId);
            await updatePlayerScorecardInFirestore(activeTournamentId, activeYear, activeRound, playerId, scorecardData);
            const roundComplete = scorecardData.some(s => {
                const id = typeof s.roundId === 'object' ? parseInt((s.roundId as any).$numberInt, 10) : Number(s.roundId);
                return id === activeRound && Boolean(s.roundComplete);
            });
            await updateScorecardSyncEntry(docId, roundComplete, INTERVAL_MS);
            successCount++;
            await sleep(150);
        } catch (err: any) {
            failedPlayerIds.push(playerId);
        }
    }

    const status = successCount > 0 ? "success" : eligible.length === 0 ? "no-op" : "error";
    await db.collection("SyncLogs").add({ timestamp: new Date(), type: "scorecards", status, message: `Synced ${successCount}/${eligible.length} eligible. Skipped: ${skippedComplete} complete, ${skippedTeeTimeNotYet} not started, ${skippedNoTeeTime} no tee time. Round ${activeRound}.`, tournamentId: activeTournamentId, roundId: activeRound, details: { tournamentId: activeTournamentId, year: activeYear, round: activeRound, eligible: eligible.length, synced: successCount, failed: failedPlayerIds.length, failedPlayerIds, skippedComplete, skippedTeeTimeNotYet, skippedNoTeeTime } });

    if (successCount > 0) {
        await fireEvent('scorecards.updated', { tournId: activeTournamentId, year: activeYear, round: activeRound });
    }
});

export const syncScorecardsV2Now = onCall({ timeoutSeconds: 540, secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeTournamentId, activeYear, activeRound } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeTournamentId || !activeYear || !activeRound) throw new HttpsError("failed-precondition", "No active tournament configured.");

    const now = Date.now();
    const INTERVAL_MS = 30 * 60 * 1000;

    const teeTimesSnapshot = await db.collection("TeeTimes").where("tournId", "==", activeTournamentId).where("year", "==", activeYear).get();
    const teeTimeMap = new Map<string, number>();
    for (const teeDoc of teeTimesSnapshot.docs) {
        const data = teeDoc.data();
        const pid = String(data.playerId ?? '');
        const teeTimes: any[] = Array.isArray(data.teeTimes) ? data.teeTimes : [];
        for (const entry of teeTimes) {
            const rId = typeof entry.roundId === 'number' ? entry.roundId : parseInt(entry.roundId, 10);
            if (rId !== activeRound) continue;
            const ts = entry.teeTimeTimestamp;
            if (!ts) continue;
            const ms = typeof ts === 'number' ? ts : new Date(ts).getTime();
            if (!isNaN(ms)) teeTimeMap.set(pid, ms);
        }
    }

    const syncSnapshot = await db.collection("Scorecard-Sync").where("tournId", "==", activeTournamentId).where("year", "==", activeYear).where("roundId", "==", activeRound).get();

    const eligible: Array<{ docId: string; playerId: string }> = [];
    let skippedComplete = 0, skippedNoTeeTime = 0, skippedTeeTimeNotYet = 0;

    for (const doc of syncSnapshot.docs) {
        const d = doc.data();
        if (d.roundComplete === true) { skippedComplete++; continue; }
        const pid = String(d.playerId);
        const teeTimeMs = teeTimeMap.get(pid);
        if (teeTimeMs === undefined) { skippedNoTeeTime++; continue; }
        if (teeTimeMs > now) { skippedTeeTimeNotYet++; continue; }
        eligible.push({ docId: doc.id, playerId: pid });
    }

    let successCount = 0;
    const failedPlayerIds: string[] = [];

    for (const { docId, playerId } of eligible) {
        try {
            const scorecardData = await fetchPlayerScorecard(activeTournamentId, String(activeYear), playerId);
            await updatePlayerScorecardInFirestore(activeTournamentId, activeYear, activeRound, playerId, scorecardData);
            const roundComplete = scorecardData.some(s => {
                const id = typeof s.roundId === 'object' ? parseInt((s.roundId as any).$numberInt, 10) : Number(s.roundId);
                return id === activeRound && Boolean(s.roundComplete);
            });
            await updateScorecardSyncEntry(docId, roundComplete, INTERVAL_MS);
            successCount++;
            await sleep(150);
        } catch (err: any) {
            failedPlayerIds.push(playerId);
        }
    }

    const msg = `[Manual] Synced ${successCount}/${eligible.length} eligible. Skipped: ${skippedComplete} complete, ${skippedTeeTimeNotYet} not started, ${skippedNoTeeTime} no tee time. Round ${activeRound}.`;
    await db.collection("SyncLogs").add({ timestamp: new Date(), type: "scorecards", status: successCount > 0 ? "success" : eligible.length === 0 ? "no-op" : "error", message: msg, tournamentId: activeTournamentId, roundId: activeRound, details: { tournamentId: activeTournamentId, year: activeYear, round: activeRound, eligible: eligible.length, synced: successCount, failed: failedPlayerIds.length, failedPlayerIds, skippedComplete, skippedTeeTimeNotYet, skippedNoTeeTime } });

    if (successCount > 0) {
        await fireEvent('scorecards.updated', { tournId: activeTournamentId, year: activeYear, round: activeRound });
    }

    return { success: true, message: msg };
});

export const fetchAllScorecardsNow = onCall({ timeoutSeconds: 540, secrets: [RAPIDAPI_API_KEY] }, async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeTournamentId, activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeTournamentId || !activeYear) throw new HttpsError("failed-precondition", "No active tournament configured.");

    const fieldSnapshot = await db.collection("Tournament-Field").where("tournId", "==", activeTournamentId).where("year", "==", activeYear).get();
    if (fieldSnapshot.empty) throw new HttpsError("failed-precondition", `No players found in Tournament-Field for ${activeTournamentId} (${activeYear}).`);

    const playerIds = fieldSnapshot.docs.map(d => String(d.data().playerId)).filter(Boolean);
    const ROUNDS = [1, 2, 3, 4];
    const INTERVAL_MS = 30 * 60 * 1000;

    let successCount = 0;
    const failedPlayerIds: string[] = [];

    for (const playerId of playerIds) {
        try {
            const scorecardData = await fetchPlayerScorecard(activeTournamentId, String(activeYear), playerId);
            for (const roundId of ROUNDS) {
                await updatePlayerScorecardInFirestore(activeTournamentId, activeYear, roundId, playerId, scorecardData);
                const syncDocId = `${activeYear}-${activeTournamentId}-${playerId}-${roundId}`;
                const syncDoc = await db.collection("Scorecard-Sync").doc(syncDocId).get();
                if (syncDoc.exists) {
                    const roundComplete = scorecardData.some(s => {
                        const id = typeof s.roundId === "number" ? s.roundId : parseInt(String(s.roundId), 10);
                        return id === roundId && s.roundComplete;
                    });
                    await updateScorecardSyncEntry(syncDocId, roundComplete, INTERVAL_MS);
                }
            }
            successCount++;
            await sleep(150);
        } catch (err: any) {
            failedPlayerIds.push(playerId);
        }
    }

    const msg = `[Manual] Fetched all scorecards: ${successCount}/${playerIds.length} players synced. ${failedPlayerIds.length} failed. Tournament: ${activeTournamentId} (${activeYear}).`;
    await db.collection("SyncLogs").add({ timestamp: new Date(), type: "scorecards", status: successCount > 0 ? "success" : "error", message: msg, tournamentId: activeTournamentId, details: { tournamentId: activeTournamentId, year: activeYear, totalPlayers: playerIds.length, synced: successCount, failed: failedPlayerIds.length, failedPlayerIds } });

    if (successCount > 0) {
        await fireEvent('scorecards.updated', { tournId: activeTournamentId, year: activeYear });
    }

    return { success: true, message: msg };
});

export const seedScorecardSyncNow = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const { activeTournamentId, activeYear } = (await db.collection("Settings").doc("autosync").get()).data() ?? {};
    if (!activeTournamentId || !activeYear) throw new HttpsError("failed-precondition", "No active tournament configured.");
    try {
        const { createdCount, updatedCount } = await populateScorecardSyncFromTeeTimes(activeTournamentId, activeYear);
        const msg = `Scorecard-Sync seeded: ${createdCount} created, ${updatedCount} updated (${activeTournamentId}, ${activeYear}).`;
        await db.collection("SyncLogs").add({ timestamp: new Date(), type: "scorecardSync", status: "success", message: `[Manual] ${msg}`, tournamentId: activeTournamentId });
        return { success: true, message: msg };
    } catch (err: any) {
        throw new HttpsError("internal", err.message || "Failed to seed Scorecard-Sync.");
    }
});

// ---------------------------------------------------------------------------
// Webhook Management (Admin callable)
// ---------------------------------------------------------------------------

export const registerWebhook = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { consumerId, url, secret, events } = (request.data ?? {}) as { consumerId: string; url: string; secret: string; events: string[] };
    if (!consumerId || !url || !secret || !events?.length) throw new HttpsError("invalid-argument", "consumerId, url, secret, and events are required.");
    const db = getFirestore();
    await db.collection("Webhook-Registrations").doc(consumerId).set({ consumerId, url, secret, events, enabled: true, updatedAt: new Date() }, { merge: true });
    return { success: true, message: `Webhook registered for ${consumerId}.` };
});

export const listWebhooks = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const db = getFirestore();
    const snap = await db.collection("Webhook-Registrations").get();
    return { webhooks: snap.docs.map(d => { const data = d.data(); return { ...data, secret: '***' }; }) };
});

export const deleteWebhook = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { consumerId } = (request.data ?? {}) as { consumerId: string };
    if (!consumerId) throw new HttpsError("invalid-argument", "consumerId is required.");
    const db = getFirestore();
    await db.collection("Webhook-Registrations").doc(consumerId).delete();
    return { success: true, message: `Webhook for ${consumerId} deleted.` };
});

export const toggleWebhook = onCall(async (request) => {
    if (request.auth?.token.admin !== true) throw new HttpsError("permission-denied", "Admin only.");
    const { consumerId, enabled } = (request.data ?? {}) as { consumerId: string; enabled: boolean };
    if (!consumerId || enabled === undefined) throw new HttpsError("invalid-argument", "consumerId and enabled are required.");
    const db = getFirestore();
    await db.collection("Webhook-Registrations").doc(consumerId).set({ enabled }, { merge: true });
    return { success: true, message: `Webhook for ${consumerId} ${enabled ? 'enabled' : 'disabled'}.` };
});

// ---------------------------------------------------------------------------
// Incoming webhook verification helper (for consumers)
// This is an HTTPS function that consumers can call to verify their setup.
// ---------------------------------------------------------------------------

export const webhookPing = onRequest(async (req, res) => {
    res.json({ status: 'ok', service: 'golf-core', timestamp: new Date().toISOString() });
});
