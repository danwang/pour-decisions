/*
 * Optional sign-in and progress sync through Supabase.
 *
 * The save in localStorage stays the source of truth: the game never waits
 * on the network, and works the same signed out or offline. When signed in,
 * each sync reads the account's copy, merges it in (SortSave.merge), and
 * writes the result back. The Supabase client loads from the CDN only once
 * someone signs in or already has a session.
 *
 * Sign-in is by email: one message carries both a link and a code, so it
 * works whether or not the link opens in the browser you play in.
 */
(function () {
  'use strict';

  const CFG = window.PourCloudConfig || {};
  const enabled = !!(CFG.url && CFG.anonKey && CFG.game);
  const SDK = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.117.2/dist/umd/supabase.js';
  const SDK_SRI = 'sha384-Rj26LVGvoeRVR6+mwQmFfcR3QOBEwT+ZmuCWpuiqeTzJpCs0ER4ITAWGb4Hiy3Ok';
  const AUTH_KEY = 'pour-decisions-auth';
  const PENDING_KEY = 'pour-decisions-signin';
  const TABLE = 'saves';
  const $ = (s) => document.querySelector(s);
  const store = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch (e) { /* ignore */ } },
  };

  // A sign-in link lands here with the session (or an error) in the URL
  // hash. Take it out before anything else reads or rewrites the URL.
  const fromLink = (() => {
    if (!enabled || !location.hash) return null;
    const h = new URLSearchParams(location.hash.slice(1));
    if (!h.has('access_token') && !h.has('error_description')) return null;
    history.replaceState(history.state, '', location.pathname + location.search);
    return { access_token: h.get('access_token'), refresh_token: h.get('refresh_token'), error: h.get('error_description') };
  })();

  const state = {
    user: null,        // { id, email } when signed in
    pending: store.get(PENDING_KEY) || '', // email a code was sent to
    busy: false,
    syncedAt: 0,
    error: '',
  };
  let hooks = null, client = null;

  /** A message worth showing a player. */
  function explain(e, fallback) {
    const m = (e && e.message) || '';
    if (/fetch|network|load failed/i.test(m) || (e && e.name === 'AuthRetryableFetchError')) return 'Couldn’t reach the sync service. Check your connection and try again.';
    return m || fallback;
  }

  // ------------------------------------------------------------- client --

  let sdkPromise = null;
  function sdk() {
    if (!sdkPromise) {
      sdkPromise = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = SDK;
        s.integrity = SDK_SRI;
        s.crossOrigin = 'anonymous';
        s.onload = () => {
          client = window.supabase.createClient(CFG.url, CFG.anonKey, {
            auth: { storageKey: AUTH_KEY, persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
          });
          client.auth.onAuthStateChange((event, session) => {
            const was = state.user && state.user.id;
            state.user = session ? { id: session.user.id, email: session.user.email } : null;
            // Deferred: Supabase calls made inside this callback can deadlock on its auth lock.
            if (state.user && state.user.id !== was) { setPending(''); setTimeout(sync, 0); }
            render();
          });
          resolve(client);
        };
        s.onerror = () => { sdkPromise = null; reject(new Error('Could not reach the sign-in service.')); };
        document.head.appendChild(s);
      });
    }
    return sdkPromise;
  }

  // --------------------------------------------------------------- sync --

  /** JSON with sorted keys, so copies that differ only in key order compare equal. */
  function stable(v) {
    if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
    if (v && typeof v === 'object') {
      return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
    }
    return JSON.stringify(v);
  }

  let running = null, queued = null, timer = null;
  /**
   * Read the account's save, merge it into this device's, and write back
   * whatever changed. `replace` skips the merge (used after a reset).
   * Calls made while one is running are folded into one more pass.
   */
  async function sync(opts) {
    clearTimeout(timer);
    if (!state.user || !client) return;
    if (running) {
      queued = { replace: !!((queued && queued.replace) || (opts && opts.replace)) };
      return running;
    }
    running = (async () => {
      const user = state.user.id;
      try {
        const { data, error } = await client.from(TABLE).select('data').eq('user_id', user).eq('game', CFG.game).maybeSingle();
        if (error) throw error;
        let remote = data && data.data;
        if (remote && (remote.v || 1) > window.SortSave.SCHEMA) throw new Error('Your account was saved by a newer version. Reload to update.');
        if (remote) remote = window.SortSave.migrate(remote, window.SortCore);
        const local = hooks.get();
        let next = opts && opts.replace ? local : window.SortSave.merge(local, remote, user);
        if (next.syncedAs !== user) next = Object.assign({}, next, { syncedAs: user });
        if (stable(next) !== stable(local)) hooks.set(next);
        if (!remote || stable(next) !== stable(remote)) {
          const { error: e2 } = await client.from(TABLE).upsert(
            { user_id: user, game: CFG.game, data: next, updated_at: new Date().toISOString() },
            { onConflict: 'user_id,game' });
          if (e2) throw e2;
        }
        state.syncedAt = Date.now();
        state.error = '';
      } catch (e) {
        state.error = explain(e, 'Sync failed.');
      }
    })();
    render();
    await running;
    running = null;
    render();
    if (queued) { const q = queued; queued = null; return sync(q); }
  }

  /** The save changed: sync soon, batching bursts of changes. */
  function changed() {
    if (!state.user) return;
    clearTimeout(timer);
    timer = setTimeout(sync, 4000);
  }

  document.addEventListener('visibilitychange', () => {
    // Push before the tab goes away; pull when it comes back.
    if (state.user) sync();
  });

  // ------------------------------------------------------------ sign-in --

  function setPending(email) { state.pending = email; store.set(PENDING_KEY, email || null); }

  async function act(fn) {
    state.busy = true; state.error = ''; render();
    try { await fn(await sdk()); } catch (e) { state.error = explain(e, 'Something went wrong.'); }
    state.busy = false; render();
  }

  // Bot check (Cloudflare Turnstile) before sending a sign-in email, so the
  // form can't be used to spam addresses. Supabase verifies the token. The
  // widget stays invisible unless Cloudflare wants an interaction; it runs
  // only on Send.
  const TURNSTILE = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
  let turnstileLoad = null, widget = null, waiting = null;
  function turnstile() {
    if (!turnstileLoad) {
      turnstileLoad = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = TURNSTILE;
        s.onload = () => resolve(window.turnstile);
        s.onerror = () => { turnstileLoad = null; reject(new Error('Couldn’t load the bot check. Check your connection and try again.')); };
        document.head.appendChild(s);
      });
    }
    return turnstileLoad;
  }
  /** A fresh single-use token, or undefined when no site key is configured. */
  async function captchaToken() {
    if (!CFG.turnstileSiteKey) return undefined;
    const ts = await turnstile();
    return new Promise((resolve, reject) => {
      const settle = (err, token) => { const w = waiting; waiting = null; if (w) err ? w.reject(err) : w.resolve(token); };
      waiting = { resolve, reject };
      if (widget == null) {
        widget = ts.render('#acctCaptcha', {
          sitekey: CFG.turnstileSiteKey,
          theme: 'dark',
          appearance: 'interaction-only',
          execution: 'execute',
          callback: (token) => settle(null, token),
          // The code says why (cloudflare.com/turnstile error codes): 1102xx is the domain, 2005xx a blocked iframe, 3xxxxx/6xxxxx a failed challenge.
          'error-callback': (code) => { settle(new Error(`Couldn’t confirm you’re not a bot (error ${code}). Try again.`)); return true; },
          'timeout-callback': () => settle(new Error('The bot check timed out. Try again.')),
        });
      } else ts.reset(widget);
      ts.execute(widget);
    });
  }

  function sendCode(email) {
    return act(async (c) => {
      const captcha = await captchaToken();
      const { error } = await c.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname, captchaToken: captcha } });
      if (error) throw error;
      setPending(email);
    });
  }

  function verify(code) {
    return act(async (c) => {
      const { error } = await c.auth.verifyOtp({ email: state.pending, token: code, type: 'email' });
      if (error) throw error;
    });
  }

  function signOut() {
    return act(async (c) => {
      await sync();
      const { error } = await c.auth.signOut();
      if (error) throw error;
      state.syncedAt = 0;
    });
  }

  // ----------------------------------------------------------------- UI --

  const ago = (t) => {
    const s = Math.round((Date.now() - t) / 1000);
    return s < 45 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`;
  };

  function render() {
    const box = $('#account'), btn = $('#accountBtn');
    if (!box) return;
    btn.hidden = !enabled;
    if (!enabled) return;
    const mode = state.user ? 'in' : state.pending ? 'code' : 'out';
    btn.classList.toggle('on', !!state.user);
    btn.setAttribute('aria-label', state.user ? 'Account: signed in' : 'Sign in to sync progress');
    $('#acctTitle').textContent = { out: 'Sync your progress', code: 'Check your email', in: 'You’re synced' }[mode];
    $('#acctOut').hidden = mode !== 'out';
    $('#acctCode').hidden = mode !== 'code';
    $('#acctIn').hidden = mode !== 'in';
    $('#acctSentTo').textContent = state.pending;
    if (state.user) {
      $('#acctWho').textContent = state.user.email;
      $('#acctStatus').textContent = running ? 'Syncing…' : state.syncedAt ? `Progress synced ${ago(state.syncedAt)}` : 'Syncing…';
    }
    for (const b of box.querySelectorAll('button, input')) b.disabled = state.busy;
    const err = $('#acctError');
    err.hidden = !state.error;
    err.textContent = state.error;
  }

  function bindUI() {
    $('#acctEmailForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const email = $('#acctEmail').value.trim();
      if (email) sendCode(email);
    });
    $('#acctCodeForm').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('#acctCodeInput').value.replace(/\D/g, '');
      if (code) verify(code).then(() => { if (!state.error) $('#acctCodeInput').value = ''; });
    });
    $('#acctRestart').addEventListener('click', () => { setPending(''); state.error = ''; render(); });
    $('#acctSignOut').addEventListener('click', signOut);
  }

  // --------------------------------------------------------------- init --

  /**
   * hooks: get() → this device's save, set(save) → adopt a merged save,
   * open() → show the account sheet.
   */
  function init(h) {
    hooks = h;
    if (!enabled) { render(); return; }
    bindUI();
    render();
    // Arriving from an email link: show how it went.
    if (fromLink) hooks.open();
    if (fromLink && fromLink.error) {
      state.error = `That sign-in link didn’t work (${fromLink.error}). ${state.pending ? 'Try the code, or send a new one.' : 'Send a new one.'}`;
      render();
    }
    if (fromLink && fromLink.access_token) {
      act((c) => c.auth.setSession({ access_token: fromLink.access_token, refresh_token: fromLink.refresh_token }).then(({ error }) => { if (error) throw error; }));
    } else if (store.get(AUTH_KEY)) {
      // Returning player: the stored session signs in through onAuthStateChange.
      sdk().catch((e) => { state.error = explain(e); render(); });
    }
  }

  window.PourCloud = {
    enabled, init, changed,
    sync: (opts) => sync(opts),
    get user() { return state.user; },
  };
})();
