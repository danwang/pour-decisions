#!/usr/bin/env node
/*
 * Builds the deployable site into dist/: the pages, stylesheet and scripts,
 * with js/version.js stamped for this commit, plus Cloudflare's _headers.
 * Everything else in the repo (tools, tests, SQL) stays off the public site.
 *   node tools/build-site.js
 */
const fs = require('fs');
const path = require('path');
const { currentVersion, versionFile } = require('./stamp-version.js');

const root = path.join(__dirname, '..');
const out = path.join(root, 'dist');
const SITE = ['index.html', 'ads.html', 'style.css', 'js'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
for (const f of SITE) fs.cpSync(path.join(root, f), path.join(out, f), { recursive: true });

const info = currentVersion();
fs.writeFileSync(path.join(out, 'js', 'version.js'), versionFile(info));
// Short cache so a deploy reaches players within minutes (same as render.yaml).
fs.writeFileSync(path.join(out, '_headers'), '/*\n  Cache-Control: public, max-age=300\n');
console.log(`built dist/ for ${info.sha.slice(0, 7)} at ${info.builtAt}`);
