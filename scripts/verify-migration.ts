/**
 * verify-migration.ts
 *
 * Verifies that the Golf Core Firestore has all the documents
 * that were expected to be migrated from Mezzters.
 *
 * Usage:
 *   npx ts-node scripts/verify-migration.ts \
 *     --source-creds ./mezzters-service-account.json \
 *     --dest-creds ./golf-core-service-account.json \
 *     [--collections golf-rankings,PGA-Schedule]
 *
 * Outputs a pass/fail report. Exit code 0 = all good, 1 = missing docs found.
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
const collectionsArg = getArg('--collections');

if (!sourceCreds || !destCreds) {
  console.error('Usage: ts-node verify-migration.ts --source-creds <path> --dest-creds <path> [--collections col1,col2]');
  process.exit(1);
}

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

// ─── Verification helpers ─────────────────────────────────────────────────────

const PAGE_SIZE = 500;

async function getAllDocIds(db: admin.firestore.Firestore, collectionName: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let lastDoc: admin.firestore.QueryDocumentSnapshot | null = null;
  while (true) {
    let q: admin.firestore.Query = db.collection(collectionName).select().limit(PAGE_SIZE);
    if (lastDoc) q = q.startAfter(lastDoc);
    const snap = await q.get();
    if (snap.empty) break;
    snap.docs.forEach(d => ids.add(d.id));
    lastDoc = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < PAGE_SIZE) break;
  }
  return ids;
}

interface VerificationResult {
  collection: string;
  sourceCount: number;
  destCount: number;
  missingIds: string[];
  passed: boolean;
}

async function verifyCollection(collectionName: string): Promise<VerificationResult> {
  process.stdout.write(`[${collectionName}] Fetching IDs from source...`);
  const sourceIds = await getAllDocIds(sourceDb, collectionName);
  process.stdout.write(` ${sourceIds.size} docs. Fetching from dest...`);
  const destIds = await getAllDocIds(destDb, collectionName);
  process.stdout.write(` ${destIds.size} docs.\n`);

  const missingIds: string[] = [];
  for (const id of sourceIds) {
    if (!destIds.has(id)) missingIds.push(id);
  }

  const passed = missingIds.length === 0;
  if (passed) {
    console.log(`[${collectionName}] ✓ PASS — all ${sourceIds.size} docs present in dest`);
  } else {
    console.log(`[${collectionName}] ✗ FAIL — ${missingIds.length} docs missing in dest`);
    if (missingIds.length <= 10) {
      missingIds.forEach(id => console.log(`    Missing: ${id}`));
    } else {
      missingIds.slice(0, 10).forEach(id => console.log(`    Missing: ${id}`));
      console.log(`    ... and ${missingIds.length - 10} more`);
    }
  }

  return { collection: collectionName, sourceCount: sourceIds.size, destCount: destIds.size, missingIds, passed };
}

// ─── Main ────────────────────────────────────────────────────────────────────

async function main() {
  console.log('='.repeat(60));
  console.log('Golf Core Migration Verification');
  console.log(`Collections: ${targetCollections.join(', ')}`);
  console.log('='.repeat(60) + '\n');

  const results: VerificationResult[] = [];

  for (const col of targetCollections) {
    const result = await verifyCollection(col);
    results.push(result);
  }

  // ─── Report ───────────────────────────────────────────────────────────────
  const allPassed = results.every(r => r.passed);

  console.log('\n' + '='.repeat(60));
  console.log('VERIFICATION SUMMARY');
  console.log('='.repeat(60));
  for (const r of results) {
    const status = r.passed ? '✓ PASS' : '✗ FAIL';
    console.log(`  ${status}  ${r.collection.padEnd(30)} source=${r.sourceCount}  dest=${r.destCount}  missing=${r.missingIds.length}`);
  }
  console.log('─'.repeat(60));

  if (allPassed) {
    console.log('\n✓ ALL CHECKS PASSED — Safe to proceed with cutover.\n');
  } else {
    const totalMissing = results.reduce((sum, r) => sum + r.missingIds.length, 0);
    console.error(`\n✗ VERIFICATION FAILED — ${totalMissing} documents missing across ${results.filter(r => !r.passed).length} collections.`);
    console.error('  Run the migration script again to fill in missing documents.\n');
  }

  // Write report
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const reportPath = path.join(process.cwd(), `verification-${timestamp}.json`);
  fs.writeFileSync(reportPath, JSON.stringify({ timestamp: new Date().toISOString(), passed: allPassed, results }, null, 2));
  console.log(`Report written to: ${reportPath}`);

  await sourceApp.delete();
  await destApp.delete();

  process.exit(allPassed ? 0 : 1);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
