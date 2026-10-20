'use strict';

/**
 * Privacy orbit for the tax visor: the assistant may read document files
 * only under the V8 data directory, exactly the root the scraper config
 * computes for downloads (path.join(v8Root(), 'data')). Kept in sync with
 * harness/scraper/config.js — a single source of truth per RULE A.
 */

const path = require('path');

function v8Root() {
  if (process.env.V8_ROOT) return process.env.V8_ROOT;
  let dir = __dirname;
  for (let index = 0; index < 6; index++) {
    if (dir === path.dirname(dir)) break;
    if (dir.endsWith('assistant')) return path.resolve(dir, '..');
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '..');
}

function localDataRoot() {
  return path.join(v8Root(), 'data');
}

module.exports = { v8Root, localDataRoot };
