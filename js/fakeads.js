/*
 * FakeAds: a parody interstitial ad system. Nothing is real, fetched,
 * tracked or sold. Self-contained (injects its own CSS, no dependencies),
 * so any page can use it:
 *
 *   const ads = FakeAds.create({ countdown: 5 });
 *   await ads.show();              // resolves when the player closes the ad
 *
 * Options (create or per show): countdown (seconds), id (a specific ad),
 * reducedMotion, container + inline (render inside a positioned element
 * instead of covering the page), captureKeys (default true: the page
 * behind gets no key presses while the ad is up), earlyClose (default
 * false: the countdown still plays, but tapping it closes the ad).
 *
 * Ads ("creatives") live in a catalog. Register your own with
 * FakeAds.register({ id, brand, tagline, render(stage, api) { … } }).
 * See js/fakeads-creatives.js for the built-in parodies.
 *
 * Creative shape:
 *   id, brand, tagline, category        strings
 *   icon: { bg, fg, text }              app-icon look
 *   rating, installs, cta               store-banner details
 *   theme: { bg, fg }                   stage colors
 *   ctaJoke                             toast when "Install" is tapped
 *   confirmshame: { title, yes, no }    optional "are you sure?" on close
 *   render(stage, api) → cleanup?       draws the ad into stage
 *
 * The api handed to render():
 *   api.loop(fn(t, dt))   per-frame callback, seconds; stops when the ad closes
 *   api.every(ms, fn)     interval; api.after(ms, fn) timeout (both auto-cleared)
 *   api.canvas()          { canvas, ctx, w, h } filling the stage, DPR-aware
 *   api.el(tag, cls, html) create an element; api.toast(text)
 *   api.reduced           true when the viewer prefers reduced motion
 *   api.rand(a, b), api.pick(arr)
 */
(function (root) {
  'use strict';

  const catalog = [];
  const CSS = `
.fa-root{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;
  background:rgba(0,0,0,.86);font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  animation:fa-in .18s ease-out;-webkit-user-select:none;user-select:none;touch-action:manipulation}
@keyframes fa-in{from{opacity:0}}
.fa-card{position:relative;display:flex;flex-direction:column;overflow:hidden;
  width:min(100vw,440px);height:min(100dvh,880px);background:var(--fa-bg,#111);color:var(--fa-fg,#fff)}
@media (min-width:480px) and (min-height:700px){.fa-card{border-radius:22px;box-shadow:0 30px 90px rgba(0,0,0,.6);height:min(92dvh,880px)}}
.fa-top{position:absolute;z-index:5;top:0;left:0;right:0;display:flex;align-items:center;justify-content:space-between;
  padding:calc(env(safe-area-inset-top,0px) + 10px) 10px 0;pointer-events:none}
.fa-top>*{pointer-events:auto}
.fa-badges{display:flex;gap:6px;align-items:center}
.fa-badge{font:700 11px/1 system-ui,sans-serif;letter-spacing:.04em;padding:4px 6px;border-radius:4px;
  background:rgba(255,204,0,.95);color:#222}
.fa-choices{display:grid;place-items:center;width:20px;height:20px;border-radius:4px;background:rgba(255,255,255,.85);
  color:#1a73e8;font:700 11px/1 Georgia,serif;font-style:italic}
.fa-close{position:relative;width:44px;height:44px;display:grid;place-items:center;border:0;padding:0;background:none;
  cursor:default;color:#fff}
.fa-close .fa-dial{width:30px;height:30px;border-radius:50%;background:rgba(0,0,0,.55);display:grid;place-items:center;position:relative}
.fa-close svg{position:absolute;inset:0;width:30px;height:30px;transform:rotate(-90deg)}
.fa-close circle{fill:none;stroke:#fff;stroke-width:2.5;stroke-linecap:round}
.fa-close .fa-num{font:700 13px/1 system-ui,sans-serif;font-variant-numeric:tabular-nums}
.fa-close .fa-x{display:none;font:400 18px/1 system-ui,sans-serif}
.fa-close.ready,.fa-close.early{cursor:pointer}
.fa-close.ready .fa-num,.fa-close.ready svg{display:none}
.fa-close.ready .fa-x{display:block}
.fa-close.ready .fa-dial{background:rgba(0,0,0,.7);animation:fa-pop .25s cubic-bezier(.3,1.6,.5,1)}
.fa-close:focus-visible{outline:2px solid #fff;outline-offset:1px;border-radius:50%}
@keyframes fa-pop{from{transform:scale(.4)}}
.fa-stage{position:relative;flex:1;min-height:0;overflow:hidden}
.fa-footer{position:relative;z-index:4;display:flex;align-items:center;gap:12px;
  padding:12px 14px calc(env(safe-area-inset-bottom,0px) + 14px);background:rgba(255,255,255,.97);color:#1d1d1f}
.fa-icon{flex:none;width:52px;height:52px;border-radius:13px;display:grid;place-items:center;overflow:hidden;
  font:900 17px/1 "Arial Black",Impact,system-ui,sans-serif;letter-spacing:-.02em;box-shadow:0 1px 3px rgba(0,0,0,.25)}
.fa-meta{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}
.fa-meta b{font:700 15px/1.2 system-ui,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fa-meta span{font:400 12px/1.25 system-ui,sans-serif;color:#555;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.fa-meta .fa-stars{color:#e8a200}
.fa-cta{flex:none;min-height:40px;padding:0 18px;border:0;border-radius:20px;background:#1a73e8;color:#fff;
  font:800 14px/1 system-ui,sans-serif;letter-spacing:.03em;cursor:pointer;animation:fa-pulse 1.1s ease-in-out infinite}
@keyframes fa-pulse{50%{transform:scale(1.07)}}
.fa-toast{position:absolute;z-index:6;left:50%;bottom:96px;transform:translateX(-50%);max-width:calc(100% - 32px);
  padding:10px 14px;border-radius:12px;background:rgba(20,20,20,.92);color:#fff;font:600 14px/1.3 system-ui,sans-serif;
  text-align:center;opacity:0;transition:opacity .2s;pointer-events:none}
.fa-toast.on{opacity:1}
.fa-shame{position:absolute;inset:0;z-index:7;display:grid;place-items:center;background:rgba(0,0,0,.6);padding:24px}
.fa-shame>div{width:100%;max-width:320px;border-radius:18px;background:#fff;color:#111;padding:22px 20px 16px;text-align:center;
  animation:fa-pop .3s cubic-bezier(.3,1.5,.5,1)}
.fa-shame h4{margin:0 0 6px;font:900 22px/1.15 "Arial Black",Impact,system-ui,sans-serif}
.fa-shame p{margin:0 0 16px;font:500 14px/1.35 system-ui,sans-serif;color:#444}
.fa-shame button{display:block;width:100%;border:0;cursor:pointer;font:inherit}
.fa-shame .fa-yes{min-height:48px;border-radius:24px;background:#1bb34a;color:#fff;font:900 17px/1 system-ui,sans-serif;
  animation:fa-pulse 1s ease-in-out infinite}
.fa-shame .fa-no{min-height:40px;margin-top:6px;background:none;color:#888;font:500 12px/1.2 system-ui,sans-serif;text-decoration:underline}
.fa-root.fa-inline{position:absolute}
.fa-inline .fa-card{width:100%;height:100%;border-radius:0}
.fa-reduced *{animation-duration:1ms!important;animation-iteration-count:1!important;transition-duration:1ms!important}
`;

  function injectCss() {
    if (document.getElementById('fakeads-css')) return;
    const s = document.createElement('style');
    s.id = 'fakeads-css';
    s.textContent = CSS;
    document.head.appendChild(s);
  }

  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  const STAGE_TAPS = [
    'Opening the store… just kidding.',
    'That was a misclick. We counted it anyway.',
    'Engagement +1. Our investors thank you.',
    'You tapped the ad. The ad noticed.',
  ];
  const EARLY_TAPS = [
    'Patience is a virtue. (Sponsored)',
    'Not yet. Enjoy the ad.',
    'The X is coming. Probably.',
  ];

  function stars(r) {
    const full = Math.floor(r), half = r - full >= 0.5;
    return '★'.repeat(full) + (half ? '½' : '');
  }

  function create(options) {
    const opts = Object.assign({ countdown: 5, container: null, catalog: null }, options || {});
    let open = null;
    let bag = [];

    function nextCreative(id) {
      const list = opts.catalog || catalog;
      if (!list.length) throw new Error('FakeAds: no creatives registered');
      if (id) return list.find((c) => c.id === id) || list[0];
      // Shuffle bag: every ad shows once before any repeats.
      if (!bag.length) {
        bag = list.slice();
        for (let i = bag.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [bag[i], bag[j]] = [bag[j], bag[i]]; }
      }
      return bag.pop();
    }

    function show(showOpts) {
      if (open) return open.promise;
      injectCss();
      const so = Object.assign({}, opts, showOpts || {});
      const ad = nextCreative(so.id);
      const reduced = !!(so.reducedMotion != null ? so.reducedMotion
        : root.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
      const theme = ad.theme || {};

      const rootEl = el('div', 'fa-root' + (reduced ? ' fa-reduced' : '') + (so.inline ? ' fa-inline' : ''));
      rootEl.setAttribute('role', 'dialog');
      rootEl.setAttribute('aria-modal', 'true');
      rootEl.setAttribute('aria-label', `Advertisement (parody): ${ad.brand}`);
      const card = el('div', 'fa-card');
      card.style.setProperty('--fa-bg', theme.bg || '#111');
      card.style.setProperty('--fa-fg', theme.fg || '#fff');
      const top = el('div', 'fa-top', `
        <div class="fa-badges"><span class="fa-badge">Ad</span><span class="fa-choices" title="Why this ad? Because.">i</span></div>`);
      const close = el('button', 'fa-close', `
        <span class="fa-dial"><svg viewBox="0 0 30 30" aria-hidden="true"><circle cx="15" cy="15" r="12.5"/></svg>
        <span class="fa-num"></span><span class="fa-x" aria-hidden="true">✕</span></span>`);
      close.type = 'button';
      top.appendChild(close);
      const stage = el('div', 'fa-stage');
      const icon = ad.icon || {};
      const footer = el('div', 'fa-footer', `
        <div class="fa-icon" style="background:${icon.bg || '#333'};color:${icon.fg || '#fff'}">${icon.text || ad.brand[0]}</div>
        <div class="fa-meta"><b>${ad.brand}</b><span>${ad.tagline || ''}</span>
          <span><span class="fa-stars">${stars(ad.rating || 4.7)}</span> ${(ad.rating || 4.7).toFixed(1)} · ${ad.installs || '10M+'} · ${ad.category || 'Game'}</span></div>
        <button class="fa-cta" type="button">${ad.cta || 'INSTALL'}</button>`);
      const toastEl = el('div', 'fa-toast');
      toastEl.setAttribute('role', 'status');
      card.append(top, stage, footer, toastEl);
      rootEl.appendChild(card);
      (so.container || document.body).appendChild(rootEl);

      // ---- timers owned by this ad
      const loops = [], timers = [];
      let raf = 0, last = 0, t0 = 0;
      function frame(now) {
        raf = requestAnimationFrame(frame);
        if (!t0) { t0 = now; last = now; }
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        tickCountdown(dt);
        const t = (now - t0) / 1000;
        for (const fn of loops) { try { fn(t, dt); } catch (e) { console.error(e); } }
      }

      let toastTimer = 0;
      function toast(text) {
        toastEl.textContent = text;
        toastEl.classList.add('on');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => toastEl.classList.remove('on'), 1800);
      }

      const api = {
        reduced,
        el,
        toast,
        rand: (a, b) => a + Math.random() * (b - a),
        pick: (arr) => arr[Math.floor(Math.random() * arr.length)],
        loop(fn) {
          if (reduced) { try { fn(1.5, 0); } catch (e) { console.error(e); } return () => {}; }
          loops.push(fn);
          return () => { const i = loops.indexOf(fn); if (i >= 0) loops.splice(i, 1); };
        },
        every(ms, fn) { const id = setInterval(fn, reduced ? Math.max(ms, 1500) : ms); timers.push(() => clearInterval(id)); return id; },
        after(ms, fn) { const id = setTimeout(fn, ms); timers.push(() => clearTimeout(id)); return id; },
        canvas() {
          const r = stage.getBoundingClientRect();
          const dpr = Math.min(2, root.devicePixelRatio || 1);
          const c = el('canvas');
          c.width = Math.round(r.width * dpr);
          c.height = Math.round(r.height * dpr);
          c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%';
          stage.appendChild(c);
          const ctx = c.getContext('2d');
          ctx.scale(dpr, dpr);
          return { canvas: c, ctx, w: r.width, h: r.height };
        },
      };

      // ---- countdown
      const total = Math.max(0, so.countdown);
      let remaining = total, ready = total === 0;
      const ring = close.querySelector('circle');
      const circ = 2 * Math.PI * 12.5;
      ring.style.strokeDasharray = String(circ);
      const num = close.querySelector('.fa-num');
      function renderCountdown() {
        num.textContent = String(Math.max(1, Math.ceil(remaining)));
        ring.style.strokeDashoffset = String(circ * (1 - remaining / (total || 1)));
        close.setAttribute('aria-label', ready || so.earlyClose ? 'Close ad' : `Close ad in ${Math.ceil(remaining)} seconds`);
      }
      function tickCountdown(dt) {
        if (ready) return;
        remaining = Math.max(0, remaining - dt);
        if (remaining <= 0) {
          ready = true;
          close.classList.add('ready');
          renderCountdown();
          close.focus({ preventScroll: true });
          return;
        }
        renderCountdown();
      }
      if (ready) close.classList.add('ready');
      if (so.earlyClose) close.classList.add('early');
      renderCountdown();

      // ---- interactions
      let installed = false;
      stage.addEventListener('click', () => toast(api.pick(STAGE_TAPS)));
      footer.querySelector('.fa-cta').addEventListener('click', (e) => {
        e.stopPropagation();
        installed = true;
        toast(ad.ctaJoke || 'This app doesn’t exist. You’re welcome.');
      });
      let shamed = false;
      close.addEventListener('click', () => {
        if (!ready && !so.earlyClose) { toast(api.pick(EARLY_TAPS)); return; }
        if (ad.confirmshame && !shamed) { shamed = true; showShame(); return; }
        finish();
      });
      function showShame() {
        const cs = ad.confirmshame;
        const box = el('div', 'fa-shame', `<div><h4>${cs.title}</h4><p>${cs.body || ''}</p>
          <button class="fa-yes" type="button">${cs.yes}</button><button class="fa-no" type="button">${cs.no}</button></div>`);
        card.appendChild(box);
        box.querySelector('.fa-yes').addEventListener('click', () => {
          installed = true;
          box.remove();
          toast(cs.yesJoke || 'It was never free. Nothing here is real.');
          api.after(1400, finish);
        });
        const no = box.querySelector('.fa-no');
        no.addEventListener('click', finish);
        no.focus({ preventScroll: true });
      }

      // Keys: nothing reaches the page behind the ad. Escape/Enter close once allowed.
      function onKey(e) {
        e.stopImmediatePropagation();
        if (e.key === 'Tab') {
          e.preventDefault();
          const focusables = Array.from(rootEl.querySelectorAll('button')).filter((b) => b.offsetParent);
          const i = focusables.indexOf(document.activeElement);
          const nextEl = focusables[(i + (e.shiftKey ? -1 : 1) + focusables.length) % focusables.length];
          if (nextEl) nextEl.focus();
        } else if (e.key === 'Escape' && (ready || so.earlyClose)) {
          e.preventDefault();
          close.click();
        }
      }
      if (so.captureKeys !== false) root.addEventListener('keydown', onKey, true);

      let cleanup = null;
      try { cleanup = ad.render(stage, api); } catch (e) { console.error(e); }
      raf = requestAnimationFrame(frame);

      let resolve;
      const promise = new Promise((r) => { resolve = r; });
      function finish() {
        if (!open) return;
        cancelAnimationFrame(raf);
        loops.length = 0;
        for (const stop of timers) stop();
        clearTimeout(toastTimer);
        if (typeof cleanup === 'function') { try { cleanup(); } catch (e) { console.error(e); } }
        root.removeEventListener('keydown', onKey, true);
        rootEl.remove();
        open = null;
        resolve({ id: ad.id, installed });
      }
      open = { promise, close: finish, ad };
      return promise;
    }

    return {
      show,
      /** Close the open ad immediately (e.g. the host navigates away). */
      dismiss() { if (open) open.close(); },
      get isOpen() { return !!open; },
      get current() { return open ? open.ad.id : null; },
    };
  }

  function register(creative) {
    const i = catalog.findIndex((c) => c.id === creative.id);
    if (i >= 0) catalog[i] = creative; else catalog.push(creative);
  }

  root.FakeAds = { create, register, catalog };
})(typeof self !== 'undefined' ? self : this);
