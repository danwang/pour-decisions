#!/usr/bin/env node
/*
 * Writes js/version.js with the commit being deployed, so the page can show
 * which build is live. Run as part of the Render build (see render.yaml);
 * tools/build-site.js uses the same stamp for Cloudflare.
 * The host provides the commit (Render, Cloudflare Pages, Workers Builds);
 * otherwise we ask git.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function currentVersion() {
  const env = process.env;
  let sha = env.RENDER_GIT_COMMIT || env.CF_PAGES_COMMIT_SHA || env.WORKERS_CI_COMMIT_SHA || env.GIT_COMMIT || '';
  if (!sha) {
    try { sha = execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim(); } catch (e) { sha = 'unknown'; }
  }
  return { sha, builtAt: new Date().toISOString() };
}

function versionFile(v) {
  return '// Written by tools/stamp-version.js at deploy time. The committed copy is a placeholder.\n' +
    `(function (root) { root.PourVersion = ${JSON.stringify(v)}; })(typeof self !== 'undefined' ? self : this);\n`;
}

if (require.main === module) {
  const info = currentVersion();
  fs.writeFileSync(path.join(__dirname, '..', 'js', 'version.js'), versionFile(info));
  console.log(`stamped build ${info.sha.slice(0, 7)} at ${info.builtAt}`);
}
module.exports = { currentVersion, versionFile };
