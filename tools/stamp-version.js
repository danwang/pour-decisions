#!/usr/bin/env node
/*
 * Writes js/version.js with the commit being deployed, so the page can show
 * which build is live. Run as part of the deploy build (see render.yaml).
 * Render provides RENDER_GIT_COMMIT; otherwise we ask git.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

let sha = process.env.RENDER_GIT_COMMIT || process.env.GIT_COMMIT || '';
if (!sha) {
  try { sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { sha = 'unknown'; }
}
const info = { sha, builtAt: new Date().toISOString() };
fs.writeFileSync(path.join(__dirname, '..', 'js', 'version.js'), versionFile(info));
console.log(`stamped build ${sha.slice(0, 7)} at ${info.builtAt}`);

function versionFile(v) {
  return '// Written by tools/stamp-version.js at deploy time. The committed copy is a placeholder.\n' +
    `(function (root) { root.PourVersion = ${JSON.stringify(v)}; })(typeof self !== 'undefined' ? self : this);\n`;
}
module.exports = { versionFile };
