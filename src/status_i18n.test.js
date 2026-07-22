/*
 * UGS — i18n status-string guard.  Run: node src/status_i18n.test.js
 *
 * BUG-05 regression: every user-facing status message must go through the i18n
 * layer, i.e. setStatus() must never be called with a bare string or template
 * literal. This test scans editor.js source and fails if a raw literal appears
 * as the first argument to setStatus(...), so a newly hardcoded message breaks
 * the build.
 */
'use strict';
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
const ck = (n, c) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.error('  FAIL', n); } };
console.log('UGS status i18n guard\n');

const src = fs.readFileSync(path.join(__dirname, 'editor.js'), 'utf8');

// find setStatus( calls whose first non-space argument opens a string/template
const re = /setStatus\(\s*(['"`])/g;
const offenders = [];
let m;
while ((m = re.exec(src))) {
  const upto = src.slice(0, m.index);
  const line = upto.split('\n').length;
  const snippet = src.slice(m.index, m.index + 60).replace(/\n[\s\S]*/, '…');
  offenders.push(`editor.js:${line}  ${snippet}`);
}
if (offenders.length) offenders.forEach(o => console.error('    hardcoded:', o));
ck('no setStatus called with a raw string/template literal', offenders.length === 0);

// sanity: the file does use the i18n helper for statuses
ck('editor uses setStatus(t(...)) for localized messages', /setStatus\(t\(/.test(src));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
