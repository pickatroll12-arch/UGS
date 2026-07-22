/*
 * UGS — save / load layer  (Stage 1 · Milestone 1)
 * ------------------------------------------------------------------
 * Turns a SaveFile (see data.js) into a JSON string and back, with
 * versioning + a migration hook, and browser helpers to export a file
 * to disk and import one from a file picker.
 *
 * Loading goes through file pickers / strings — never fetch() — so the
 * whole thing keeps working from file:// with no server (see ROADMAP).
 *
 * Runs in browser (window.UGS.save) and Node (module.exports) for testing.
 */
(function (root, factory) {
  const dataApi = (root.UGS && root.UGS.data)
    || (typeof require !== 'undefined' ? require('./data.js') : null);
  if (!dataApi) throw new Error('UGS.save requires UGS.data to be loaded first.');
  const api = factory(dataApi);
  root.UGS = root.UGS || {};
  root.UGS.save = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';

  // Migrations: map an older formatVersion up to the current one. Each entry
  // takes the raw object at version N and returns it shaped for version N+1.
  // Empty for now (we are at v1); this is the seam so v1 saves never break.
  const MIGRATIONS = {
    // v1 → v2 (R2-06): walls become pieces. Convert each tile's legacy string
    // wall ('solid'/'diagA'/'diagB') + sibling wallMaterial into a
    // { kind, orientation, collision, material } object, and drop wallMaterial.
    1: (raw) => {
      for (const lvl of (raw.levels || [])) {
        for (const room of (lvl.rooms || [])) {
          const rows = room.tiles || [];
          for (const row of rows) {
            for (const tile of (row || [])) {
              if (!tile) continue;
              tile.wall = data.normalizeWall(tile.wall, tile.wallMaterial);
              delete tile.wallMaterial;
            }
          }
        }
      }
      return raw;
    }
  };

  function migrate(raw) {
    let v = Number(raw.formatVersion) || 1;
    while (v < data.FORMAT_VERSION) {
      const step = MIGRATIONS[v];
      if (!step) break;               // no path defined; normalizeSave will coerce
      raw = step(raw);
      v += 1;
      raw.formatVersion = v;
    }
    return raw;
  }

  // Serialize a live SaveFile to a pretty JSON string, stamping updatedAt.
  function serialize(save, pretty = true) {
    const copy = clone(save);
    copy.format = data.FORMAT;
    copy.formatVersion = data.FORMAT_VERSION;
    copy.updatedAt = new Date().toISOString();
    return JSON.stringify(copy, null, pretty ? 2 : 0);
  }

  // Parse + migrate + normalize an incoming string/object into a clean SaveFile.
  // Returns { save, warnings }. Throws only on unparseable / wrong-format input.
  function deserialize(input) {
    let raw = input;
    if (typeof input === 'string') {
      raw = JSON.parse(input);        // may throw — caller handles
    }
    if (!raw || typeof raw !== 'object') throw new Error('Not a save object.');
    if (raw.format && raw.format !== data.FORMAT) {
      throw new Error(`Unknown format "${raw.format}" (expected "${data.FORMAT}").`);
    }
    raw = migrate(raw);
    return data.normalizeSave(raw);
  }

  function clone(obj) {
    return typeof structuredClone === 'function'
      ? structuredClone(obj)
      : JSON.parse(JSON.stringify(obj));
  }

  function slug(name) {
    return String(name || 'station').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'station';
  }

  // ---- browser-only helpers (no-ops / guarded under Node) -----------------
  function exportToFile(save) {
    if (typeof document === 'undefined') throw new Error('exportToFile is browser-only.');
    const text = serialize(save, true);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${slug(save.name)}.ugs.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    return a.download;
  }

  // Reads a File (from an <input type="file">) and resolves { save, warnings }.
  function importFromFile(file) {
    if (typeof FileReader === 'undefined') return Promise.reject(new Error('importFromFile is browser-only.'));
    return file.text().then(text => deserialize(text));
  }

  return { MIGRATIONS, migrate, serialize, deserialize, slug, exportToFile, importFromFile };
});
