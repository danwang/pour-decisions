// Supabase project for signing in and syncing progress. Both values are
// public (the anon key only grants what the database's row-level security
// allows). Leave them empty to turn sign-in off. `game` names this game's
// row in the shared saves table, so other games can use the same project.
window.PourCloudConfig = {
  url: 'https://cbsxfvkkeuxfflbucawb.supabase.co',
  anonKey: 'sb_publishable_4oLw4BClpCMsIkC-oGayAg_6CJhJ_RI',
  game: 'pour',
};
