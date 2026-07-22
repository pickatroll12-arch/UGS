#!/usr/bin/env node
/*
 * UGS — aggregate test runner.
 *
 * Runs every Node self-test suite as a child process, echoes its output, and
 * summarises the totals.  Exits non-zero if any suite fails or crashes, so it
 * is safe to wire into `npm test` and CI.
 *
 *   node scripts/run-tests.js
 *
 * Each suite prints a trailing line like "23 passed, 0 failed"; we parse that
 * to build the grand total.  A suite that crashes (non-zero exit without a
 * summary line) is reported as a failed suite.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

// Discover *.test.js under src/ so new suites are picked up automatically.
const suites = fs.readdirSync(SRC)
  .filter((f) => f.endsWith('.test.js'))
  .sort()
  .map((f) => path.join(SRC, f));

if (suites.length === 0) {
  console.error('No *.test.js suites found under src/.');
  process.exit(1);
}

const SUMMARY_RE = /(\d+)\s+passed,\s+(\d+)\s+failed/i;

let totalPass = 0;
let totalFail = 0;
let suitesFailed = 0;
const rows = [];

console.log(`UGS test runner — ${suites.length} suite(s)\n`);

for (const suite of suites) {
  const name = path.relative(ROOT, suite);
  const res = spawnSync(process.execPath, [suite], { encoding: 'utf8' });

  if (res.stdout) process.stdout.write(res.stdout);
  if (res.stderr) process.stderr.write(res.stderr);

  const out = `${res.stdout || ''}\n${res.stderr || ''}`;
  const m = out.match(SUMMARY_RE);

  if (res.status !== 0 || !m) {
    suitesFailed++;
    const pass = m ? Number(m[1]) : 0;
    const fail = m ? Number(m[2]) : 0;
    totalPass += pass;
    totalFail += fail || 1;
    rows.push({ name, pass, fail: fail || '—', ok: false });
    if (!m) console.error(`  !! ${name} produced no summary line (exit ${res.status}).`);
  } else {
    const pass = Number(m[1]);
    const fail = Number(m[2]);
    totalPass += pass;
    totalFail += fail;
    if (fail > 0) suitesFailed++;
    rows.push({ name, pass, fail, ok: fail === 0 });
  }
}

console.log('\n──────── summary ────────');
for (const r of rows) {
  const mark = r.ok ? 'ok  ' : 'FAIL';
  console.log(`  ${mark} ${r.name.padEnd(24)} ${r.pass} passed, ${r.fail} failed`);
}
console.log('─────────────────────────');
console.log(`  ${totalPass} passed, ${totalFail} failed across ${suites.length} suite(s)`);

process.exit(suitesFailed > 0 || totalFail > 0 ? 1 : 0);
