import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const workflow = await readFile('.github/workflows/release.yml', 'utf8');
const inventory = await readFile('docs/release/dependency-inventory.md', 'utf8');
const jobsBlock = workflow.match(/^jobs:\r?\n([\s\S]*)$/m)?.[1] || '';
const jobs = [...jobsBlock.matchAll(/^  ([a-zA-Z0-9_-]+):\r?$/gm)].map((match) => match[1]);
assert.deepEqual(jobs, ['release'], 'Update the hand-written job inventory when workflow jobs change.');
assert.ok(!jobs.includes('push') && !jobs.includes('workflow_dispatch'), 'Workflow triggers must not be mistaken for jobs.');
for (const job of jobs) assert.ok(inventory.includes(`\`${job}\``), `Dependency inventory is missing ${job}`);
assert.ok(workflow.includes('actions/setup-node@v4'));
assert.ok(workflow.includes('npm ci --no-audit --no-fund'));
console.log(`PASS: ${jobs.length} workflow job has an explicit dependency inventory and cache-miss bootstrap path.`);
