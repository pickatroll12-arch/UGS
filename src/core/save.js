/*
 * UGS — core/save  (REVAMP · base nueva)
 * ==================================================================
 * [COMPONENTES LÓGICOS] — persistencia: JSON puro a través de
 * data.normalizeStation (los contratos de colisión viajan con el modelo).
 * Formato v1 limpio: el revamp arranca sin migraciones legacy.
 *
 * Corre en navegador (window.UGS.save) y en Node (module.exports).
 */
(function (root, factory) {
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('./data.js') : null);
  const api = factory(dataApi);
  root.UGS = root.UGS || {};
  root.UGS.save = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (DATA) {
  'use strict';

  function serialize(station) { return JSON.stringify(station, null, 2); }

  function deserialize(json) {
    let raw;
    try { raw = typeof json === 'string' ? JSON.parse(json) : json; }
    catch (e) { throw new Error('invalid JSON: ' + e.message); }
    return DATA.normalizeStation(raw);
  }

  function exportToFile(station) {
    const name = (station.name || 'station').replace(/[^\w\- ]+/g, '').trim().replace(/\s+/g, '_') || 'station';
    const blob = new Blob([serialize(station)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name + '.ugs.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    return a.download;
  }

  function importFromFile(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onerror = () => reject(new Error('cannot read file'));
      r.onload = () => { try { resolve(deserialize(String(r.result))); } catch (e) { reject(e); } };
      r.readAsText(file);
    });
  }

  return { serialize, deserialize, exportToFile, importFromFile };
});
