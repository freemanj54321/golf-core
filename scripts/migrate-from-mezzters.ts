/**
 * migrate-from-mezzters.ts
 *
 * Migrates golf-related Firestore collections from the Mezzters project
 * to the Golf Core project using two separate Admin SDK instances.
 *
 * Usage:
 *   npx ts-node scripts/migrate-from-mezzters.ts \
 *     --source-creds ./mezzters-service-account.json \
 *     --dest-creds ./golf-core-service-account.json \
 *     [--dry-run] \
 *     [--collections golf-rankings,PGA-Schedule]
 *
 * Options:
 *   --source-creds  Path to Mezzters service account JSON (roles/datastore.viewer minimum)
 *   --dest-creds    Path to Golf Core service account JSON (roles/datastore.user)
 *   --dry-run       Log counts only, no writes
 *   --collections   Comma-separated list of collections to migrate (default: all)
 */

import * as admin from 'firebase-admin';
import * as fs from 'fs';
import * as path from 'path';

// ─── CLI argument parsing ────────────────────────────────────────────────────

const args = process.argv.slice(2);
const getArg = (name: string): string | undefined => {
  const idx = args.indexOf(name);
  return idx !== -1 ? args[idx + 1] : undefined;
};

const sourceCreds = getArg('--source-creds');
const destCreds = getArg('--dest-creds');
const dryRun = args.includes('--dry-run');
const collectionsArg = getArg('--collections');

if (!sourceCreds || !destCreds) {
  console.error('Usage: ts-node migrate-from-mezzters.ts --source-creds <path> --dest-creds <path> [--dry-run] [--collections col1,col2]');
  process.exit(1);
}

// ─── Collections to migrate ──────────────────────────────────────────────────

const ALL_COLLECTIONS = [
  'golf-rankings',
  'PGA-Schedule',
  'Tournament-Field',
  'Tournament-Results',
  'raw-tournament-results',
  'Player-Scorecards',
  'TeeTimes',
  'Scorecard-Sync',
];

// Settings doc (single document, not full collection clone)
const SETTINGS_DOC = { collection: 'Settings', docId: 'autosync' };

const targetCollections = collectionsArg
  ? collectionsArg.split(',').map(s => s.trim()).filter(Boolean)
  : ALL_COLLECTIONS;

// ─── Initialize Firebase Admin apps ──────────────────────────────────────────

const loadCreds = (p: string): admin.ServiceAccount => {
  const absPath = path.resolve(process.cwd(), p);
  if (!fs.existsSync(absPath)) {
    console.error(`Credentials file not found: ${absPath}`);
    process.exit(1);
  }
  return JSON.parse(fs.readFileSync(absPath, 'utf8')) as admin.ServiceAccount;
};

const sourceApp = admin.initializeApp(
  { credential: admin.credential.cert(loadCreds(sourceCreds)) },
  'source'
);
const destApp = admin.initializeApp(
  { credential: admin.credential.cert(loadCreds(destCreds)) },
  'dest'
);

const sourceDb = admin.firestore(sourceApp);
const destDb = admin.firestore(destApp);

// ─── Migration result tracking ────────────────────────────────────────────────

interface CollectionResult {
  collection: string;
  docCount: number;
  skipped: number;
  errors: number;
  durationMs: number;
}

const results: CollectionResult[] = [];
const PAGE_SIZE = 500;
const BATCH_WRITE_SIZE = 450;

// ─── Migration helpers ────────────────────────────────────────────────────────

async function getExistingDocIds(collectionName: string): Promise<Set<string>> {
  const existing = new Set<string>();
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q: admin.firestore.Query = destDb.collection(collectionName).select().limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach(d => existing.add(d.id));
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }
  return existing;
}

async function migrateCollection(collectionName: string): Promise<CollectionResult> {
  const start = Date.now();
  console.log(`\n[${collectionName}] Starting migration...`);

  const existingIds = dryRun ? new Set<string>() : await getExistingDocIds(collectionName);
  if (!dryRun) console.log(`[${collectionName}] ${existingIds.size} docs already exist in dest (will skip)`);

  let docCount = 0;
  let skipped = 0;
  let errors = 0;
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  let batch = destDb.batch();
  let batchOps = 0;

  const commitBatch = async () => {
    if (batchOps > 0 && !dryRun) {
      await batch.commit();
      batch = destDb.batch();
      batchOps = 0;
    }
  };

  while (true) {
    let q: admin.firestore.Query = sourceDb.collection(collectionName).limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      if (existingIds.has(docSnap.id)) {
        skipped++;
        continue;
      }

      try {
        if (!dryRun) {
          batch.set(destDb.collection(collectionName).doc(docSnap.id), docSnap.data(), { merge: true });
          batchOps++;
        }
        docCount++;
      } catch (err) {
        errors++;
        console.error(`[${collectionName}] Error queuing doc ${docSnap.id}:`, err);
      }

      if (!dryRun && batchOps >= BATCH_WRITE_SIZE) {
        await commitBatch();
        process.stdout.write(`[${collectionName}] Written ${docCount} docs so far...\r`);
      }
    }

    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }

  await commitBatch();

  const result: CollectionResult = {
    collection: collectionName,
    docCount,
    skipped,
    errors,
    durationMs: Date.now() - start,
  };

  if (dryRun) {
    console.log(`[${collectionName}] DRY RUN — would migrate ${docCount} docs (${skipped} already exist) in ${result.durationMs}ms`);
  } else {
    console.log(`[${collectionName}] ✓ Migrated ${docCount} docs (${skipped} skipped, ${errors} errors) in ${result.durationMs}ms`);
  }

  return result;
}

async function migrateSettingsDoc(): Promise<void> {
  console.log(`\n[Settings/autosync] Migrating single document...`);
  try {
    const sourceSnap = await sourceDb.collection(SETTINGS_DOC.collection).doc(SETTINGS_DOC.docId).get();
    if (!sourceSnap.exists) {
      console.log(`[Settings/autosync] Not found in source, skipping.`);
      return;
    }

    if (!dryRun) {
      const destRef = destDb.collection(SETTINGS_DOC.collection).doc(SETTINGS_DOC.docId);
      const destSnap = await destRef.get();
      if (destSnap.exists) {
        console.log(`[Settings/autosync] Already exists in dest, skipping.`);
        return;
      }
      await destRef.set(sourceSnap.data()!, { merge: true });
      console.log(`[Settings/autosync] ✓ Migrated.`);
    } else {
      console.log(`[Settings/autosync] DRY RUN — would migrate Settings/autosync doc.`);
    }
  } catch (err) {
    console.error(`[Settings/autosync] Error:`, err);
  }
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log(`Golf Core Migration from Mezzters`);
  console.log(`Mode: ${dryRun ? 'DRY RUN (no writes)' : 'LIVE'}`);
  console.log(`Collections: ${targetCollections.join(', ')}`);
  console.log('='.repeat(60));

  for (const col of targetCollections) {
    if (!ALL_COLLECTIONS.includes(col)) {
      console.warn(`Unknown collection "${col}" — skipping`);
      continue;
    }
    const result = await migrateCollection(col);
    results.push(result);
  }

  // Always migrate Settings/autosync if not specifically excluded
  if (!collectionsArg || collectionsArg.includes('Settings')) {
    await migrateSettingsDoc();
  }

  // ─── Write report ─────────────────────────────────────────────────────────
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(process.cwd(), `migration-${timestamp}.json`);

  const report = {
    timestamp: new Date().toISOString(),
    dryRun,
    collections: results,
    totalDocs: results.reduce((sum, r) => sum + r.docCount, 0),
    totalSkipped: results.reduce((sum, r) => sum + r.skipped, 0),
    totalErrors: results.reduce((sum, r) => sum + r.errors, 0),
  };

  if (!dryRun) {
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    console.log(`\nReport written to: ${reportPath}`);
  }

  console.log('\n' + '='.repeat(60));
  console.log('MIGRATION SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`  ${r.collection.padEnd(30)} ${String(r.docCount).padStart(6)} docs  ${String(r.skipped).padStart(4)} skipped  ${r.errors > 0 ? `${r.errors} ERRORS` : 'no errors'}`);
  }
  console.log('─'.repeat(60));
  console.log(`  ${'TOTAL'.padEnd(30)} ${String(report.totalDocs).padStart(6)} docs  ${String(report.totalSkipped).padStart(4)} skipped`);

  if (report.totalErrors > 0) {
    console.error(`\n⚠ ${report.totalErrors} errors occurred. Check output above.`);
    process.exit(1);
  } else {
    console.log(`\n✓ Migration ${dryRun ? 'dry run ' : ''}completed successfully.`);
  }

  await sourceApp.delete();
  await destApp.delete();
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
