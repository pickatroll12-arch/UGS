/*
 * UGS — i18n self-test.  Run: node src/i18n.test.js
 */
'use strict';
const i18n = require('./i18n.js');

let pass = 0, fail = 0;
const ck = (n, c) => { if (c) { pass++; console.log('  ok  ', n); } else { fail++; console.error('  FAIL', n); } };
console.log('UGS i18n self-test\n');

// --- default language in Node is the fallback (no navigator/localStorage) ---
ck('defaults to English fallback', i18n.getLang() === 'en');
ck('lists en and es', i18n.languages().includes('en') && i18n.languages().includes('es'));

// --- basic translation ---
ck('translates a known key (en)', i18n.t('tool.select') === 'Select');
i18n.setLang('es');
ck('setLang switches active language', i18n.getLang() === 'es');
ck('translates a known key (es)', i18n.t('tool.select') === 'Seleccionar');

// --- fallback to English for a key present only in en ---
{
  // inject a temporary en-only key
  i18n._dicts.en['__test.only'] = 'OnlyEnglish';
  ck('falls back to English when missing in active lang', i18n.t('__test.only') === 'OnlyEnglish');
  delete i18n._dicts.en['__test.only'];
}

// --- missing key returns a visible marker ---
ck('missing key returns ⟦marker⟧', i18n.t('nope.not.here') === '⟦nope.not.here⟧');

// --- interpolation ---
{
  i18n._dicts.en['__test.hello'] = 'Hi {who}, {n} left';
  i18n.setLang('en');
  ck('interpolates params', i18n.t('__test.hello', { who: 'Cap', n: 3 }) === 'Hi Cap, 3 left');
  ck('leaves unknown placeholders intact', i18n.t('__test.hello', { who: 'Cap' }) === 'Hi Cap, {n} left');
  delete i18n._dicts.en['__test.hello'];
}

// --- has() reports presence per language ---
i18n.setLang('es');
ck('has() true for present key', i18n.has('tool.floor') === true);
ck('has() false for absent key', i18n.has('totally.absent') === false);

// --- label() returns fallback string for unknown keys ---
ck('label() uses provided fallback when key unknown', i18n.label('obj.__none', 'RawLabel') === 'RawLabel');
ck('label() translates when key known', i18n.label('obj.console', 'x') === 'Consola');

// --- unknown language is a no-op ---
{
  const before = i18n.getLang();
  i18n.setLang('zz');
  ck('unknown language ignored', i18n.getLang() === before);
}

// --- subscribe fires on language change ---
{
  let seen = null;
  const off = i18n.subscribe((l) => { seen = l; });
  i18n.setLang('en');
  ck('subscriber notified on change', seen === 'en');
  off();
  seen = null;
  i18n.setLang('es');
  ck('unsubscribed listener not notified', seen === null);
}

// --- KEY PARITY: every en key exists in es and vice versa ---
{
  const en = Object.keys(i18n._dicts.en).filter(k => !k.startsWith('__'));
  const es = Object.keys(i18n._dicts.es).filter(k => !k.startsWith('__'));
  const missingInEs = en.filter(k => !(k in i18n._dicts.es));
  const missingInEn = es.filter(k => !(k in i18n._dicts.en));
  if (missingInEs.length) console.error('    es missing:', missingInEs.join(', '));
  if (missingInEn.length) console.error('    en missing:', missingInEn.join(', '));
  ck('every en key has an es translation', missingInEs.length === 0);
  ck('every es key has an en translation', missingInEn.length === 0);
}

// --- no empty translations ---
{
  let empties = [];
  for (const lang of ['en', 'es']) {
    for (const [k, v] of Object.entries(i18n._dicts[lang])) {
      if (k.startsWith('__')) continue;
      if (typeof v !== 'string' || v.length === 0) empties.push(lang + ':' + k);
    }
  }
  if (empties.length) console.error('    empties:', empties.join(', '));
  ck('no empty translation strings', empties.length === 0);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
