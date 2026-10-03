/*
 * Where new levels go in the campaign.
 *
 * The campaign is append-only: the original 200 levels ("base") never
 * change, and new levels are inserted as keyed slots between them. A slot's
 * key is its permanent name; once built, its puzzle is kept on every rebuild.
 * Rename or remove a key only if you mean to replace that puzzle.
 *
 * Each chapter of 20 base levels can take slots after base positions
 * AFTER[0..4] (0-based within the chapter), so a chapter with five slots
 * has 25 levels.
 */

/** Release that introduced a slot: drives "New" badges for returning players. */
const RELEASE = 2;

const AFTER = [1, 5, 9, 13, 17];

/**
 * Mechanics: heights (tall & short tubes), only (a tube reserved for one
 * color), locks (a tube sealed until a color is finished), limit (move limit).
 * The first slot using a mechanic is its intro. Role 'hard' aims higher.
 */
const CHAPTERS = {
  2: [['heights'], ['heights'], ['heights'], ['heights'], ['heights', 'hard']],
  3: [['only'], ['only'], ['heights'], ['only'], ['only', 'heights', 'hard']],
  4: [['limit'], ['limit'], ['heights'], ['only'], ['limit', 'heights', 'hard']],
  5: [['locks'], ['locks'], ['limit'], ['locks', 'only'], ['locks', 'heights', 'hard']],
  6: [['heights', 'only'], ['locks', 'limit'], ['heights'], ['only', 'limit'], ['locks', 'heights', 'hard']],
  7: [['locks', 'only'], ['heights', 'limit'], ['only'], ['locks', 'heights'], ['heights', 'only', 'limit', 'hard']],
  8: [['heights', 'locks'], ['only', 'limit'], ['locks'], ['heights', 'only'], ['locks', 'limit', 'heights', 'hard']],
  9: [['only', 'locks'], ['heights', 'limit'], ['locks', 'only'], ['heights', 'only'], ['heights', 'locks', 'limit', 'hard']],
};

/**
 * Slots for chapter `ch` (0-based), each { key, after, mechanics, role }.
 * Keys look like "c3s1" (chapter 3, slot 1): stable as long as the plan's
 * shape is stable.
 */
function slotsFor(ch) {
  const rows = CHAPTERS[ch] || [];
  const introduced = new Set();
  for (let c = 0; c < ch; c++) for (const row of CHAPTERS[c] || []) for (const m of row) introduced.add(m);
  return rows.map((row, i) => {
    const mechanics = row.filter((m) => m !== 'hard');
    const fresh = mechanics.find((m) => !introduced.has(m));
    for (const m of mechanics) introduced.add(m);
    return {
      key: `c${ch + 1}s${i + 1}`,
      after: AFTER[i],
      mechanics,
      role: row.includes('hard') ? 'hard' : fresh ? 'intro' : 'normal',
      intro: fresh || null,
    };
  });
}

module.exports = { RELEASE, slotsFor };
