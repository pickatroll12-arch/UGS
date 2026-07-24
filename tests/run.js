/*
 * UGS — runner de tests (sin dependencias).  Uso: node tests/run.js
 * Ejecuta todo tests/*.test.js en orden y falla si alguno falla.
 */
'use strict';
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const dir = __dirname;
const files = fs.readdirSync(dir).filter(f => f.endsWith('.test.js')).sort();
if (!files.length) { console.error('no test files'); process.exit(1); }

let failed = 0;
for (const f of files) {
  console.log('\n=== ' + f + ' ===');
  const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}
console.log('\n' + (failed ? `${failed} suite(s) FAILED` : 'ALL SUITES GREEN'));
process.exit(failed ? 1 : 0);
