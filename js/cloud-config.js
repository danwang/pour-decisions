// Supabase project for signing in and syncing progress. Both values are
// public (the anon key only grants what the database's row-level security
// allows). Leave them empty to turn sign-in off. `game` names this game's
// row in the shared saves table, so other games can use the same project.
window.PourCloudConfig = {
  url: 'https://cbsxfvkkeuxfflbucawb.supabase.co',
  anonKey: 'sb_publishable_4oLw4BClpCMsIkC-oGayAg_6CJhJ_RI',
  game: 'pour',
  // Cloudflare Turnstile site key (public). Supabase holds the secret and
  // rejects sign-in emails without a valid token. Empty skips the check.
  turnstileSiteKey: '0x4AAAAAAFNIw-5U2S-Q5_V6',
};
