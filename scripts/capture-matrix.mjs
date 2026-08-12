import { copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const args = new Map(process.argv.slice(2).map((part) => { const [key, ...value] = part.replace(/^--/, '').split('='); return [key, value.join('=')]; }));
const port = Number(args.get('port'));
const outputDir = path.resolve(args.get('output-dir') || 'docs/assets/runtime');
if (!Number.isInteger(port)) throw new Error('Usage: node scripts/capture-matrix.mjs --port=9339 [--output-dir=docs/assets/runtime]');
const baselineStates = ['volumes', 'favorites', 'create', 'properties', 'security', 'tools', 'converter', 'preferences', 'history', 'locks', 'auth', 'support', 'settings', 'logo', 'palette', 'regex', 'appearance', 'confirm', 'menu', 'lock-wizard', 'navigator', 'error', 'light', 'narrow'];
const expandedStates = ['ollama-offline', 'converter-catalog', 'pdf-tools', 'converter-bulk-queue', 'converter-recovery', 'ollama-runtime', 'model-catalog', 'model-pc-fit', 'download-cart', 'chat', 'harnesses', 'restore'];
const states = [...baselineStates, ...expandedStates];
const expectedStateCount = 36;
if (baselineStates.length !== 24 || states.length !== expectedStateCount || new Set(states).size !== states.length) {
  throw new Error(`Capture matrix inventory is invalid: ${baselineStates.length} baseline, ${states.length} total, ${new Set(states).size} unique; expected 24 baseline and ${expectedStateCount} unique total.`);
}
await mkdir(path.dirname(outputDir), { recursive: true });
const stagingDir = await mkdtemp(path.join(path.dirname(outputDir), '.capture-matrix-'));
const records = [];
try {
for (const state of states) {
  const output = path.join(stagingDir, `material-encryption-${state}.png`);
  const result = spawnSync(process.execPath, ['scripts/capture-runtime.mjs', `--port=${port}`, `--state=${state}`, `--output=${output}`], { cwd: process.cwd(), encoding: 'utf8', timeout: 30000, windowsHide: true });
  if (result.error) throw new Error(`${state} capture process failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`${state} capture failed:\n${result.stdout}\n${result.stderr}`);
  const lines = result.stdout.trim().split(/\r?\n/).filter(Boolean);
  let record;
  try { record = JSON.parse(lines.at(-1)); }
  catch (error) { throw new Error(`${state} did not emit a final JSON record: ${error.message}\n${result.stdout}`); }
  if (record.state !== state || path.resolve(record.output) !== path.resolve(output)) throw new Error(`${state} emitted mismatched state/output evidence.`);
  if (!Array.isArray(record.headings) || !record.headings.length || !Array.isArray(record.markers)) throw new Error(`${state} omitted heading or marker evidence.`);
  if (record.logo !== true || record.horizontalOverflow !== false) throw new Error(`${state} omitted logo or no-overflow proof.`);
  if (!['packaged-runtime-ui', 'actual-bridge-runtime-observation', 'seeded-visual-fixture'].includes(record.evidenceKind) || !record.evidenceLabel) throw new Error(`${state} omitted its evidence kind or label.`);
  if (expandedStates.includes(state) && state !== 'ollama-offline' && (record.evidenceKind !== 'seeded-visual-fixture' || record.fixtureSchemaVersion !== 1 || record.fixtureId !== state)) throw new Error(`${state} must carry its versioned seeded-visual-fixture acknowledgement.`);
  if (state === 'ollama-offline' && record.evidenceKind !== 'actual-bridge-runtime-observation') throw new Error('ollama-offline must remain actual packaged bridge/runtime evidence.');
  if (baselineStates.includes(state) && record.evidenceKind !== 'packaged-runtime-ui') throw new Error(`${state} must remain packaged renderer UI evidence without an external-service claim.`);
  records.push({ ...record, output: path.join(outputDir, path.basename(output)) });
}
for (const record of records) {
  const expectedSize = record.state === 'narrow' ? [390, 844] : [1440, 900];
  if (record.width !== expectedSize[0] || record.height !== expectedSize[1]) throw new Error(`${record.state} captured at ${record.width}x${record.height}, expected ${expectedSize.join('x')}.`);
}
const manifest = {
  schemaVersion: 2,
  capturedAt: new Date().toISOString(),
  source: 'packaged resources/app.asar through isolated loopback CDP on a cheap Lowlevel hidden desktop',
  stateCount: expectedStateCount,
  baselineStateCount: baselineStates.length,
  seededVisualFixtureCount: expandedStates.length - 1,
  packagedRuntimeUiCount: baselineStates.length,
  actualBridgeRuntimeObservationCount: 1,
  evidenceBoundary: 'Seeded visual fixtures exercise deterministic renderer states only and are not live file, model, download, chat, harness, restore, or Ollama-service proof. ollama-offline remains an actual packaged bridge/runtime observation.',
  states: records
};
await mkdir(outputDir, { recursive: true });
for (const record of records) await copyFile(path.join(stagingDir, path.basename(record.output)), record.output);
await writeFile(path.join(outputDir, 'capture-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`PASS: captured ${records.length} packaged runtime states (${manifest.seededVisualFixtureCount} seeded visual fixtures, ${manifest.packagedRuntimeUiCount} packaged UI interactions, ${manifest.actualBridgeRuntimeObservationCount} actual bridge/runtime observation) to ${outputDir}.`);
} finally {
  await rm(stagingDir, { recursive: true, force: true });
}
