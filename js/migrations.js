/*
 * Saved-data migrations. Progress is keyed by puzzle content id
 * (SortCore.puzzleId), never by level number, so reordering or replacing
 * levels can't hand a new puzzle an old puzzle's stars.
 *
 * To change the save format: bump SCHEMA, and add a step that upgrades
 * version SCHEMA-1 data. Steps run in order, so old saves pass through each.
 */
(function (root) {
  'use strict';

  const SCHEMA = 2;

  // Content ids of the v1 campaign (level 1 first), for saves keyed by level number.
  const V1_LEVEL_IDS = '18ssorf1un4h3j,83fnqbw0a0uv,nng1d31ylfah7,1hcl4rh1xfhhsx,175f5ufjnrfqz,4dvz6t1l5mmix,uyl7vn2hwdnr,155kjdtfd6let,4k598113l0wd1,1y7il2p187vzqt,1ludovhhdskj5,rx5c0f1e5iypf,1tvxbjb1nwuc23,vm2zz312hbydf,ttkspd22u651,1gj7sr311j4m1f,uypvvdoidz3,10amq3n1qwvbbb,1ksherv46gjtr,jwocmpj8s69h,1pei88j1tjsbx3,lzbqnfls6oen,yyqv4f1tkoewz,1l5xi4f16negtf,1n2taax1qfkw6l,j126hpv10ckh,8e9cud160d2pl,fhkuil1oxf4ap,11nlugxb5n6b9,1xnckt11e89zc9,16gqpmf1tfgxcb,z0monxmd6rq9,1lcus0711j92cr,1mghv5t827nnp,1g7nrh15e9ych,tl4tgv1e0bj6b,1w0c91c0bnj1,smdvp11lhjhs9,1jyjd8h130idz9,10yci3h1dl9jsx,76zmlh1yv3q5l,162vxhv1e13xdz,1r9ezcf1gn4y9v,y7txnjc7cu9f,12oi0wl1f92rt,ttawov8f19v,1xmjcfp65vz55,1ons5xbcadvpf,umzmnz11k0y4j,ibkdcvcec4kj,3xdkj91b4gzi1,lpryoz12d9vd3,82ot1nh1hh5,1b55vyd4is7g9,sjmmg95pfejx,1voh7evprja0b,rrhdc7wgk81n,huwha1152nu9p,1s8atjxs6y975,vby3ar22ve5j,11bgu0z1upvuzr,9x4rmb159mz5j,1ll1zkx10etkt1,1attxgf1ljy1f7,1i2njf317kgjmb,a7jo2jjyvgpb,192ny3x1aace69,lcs1v1yp2n5z,1tmtc95x9y7nx,bssrys1qwliu8,qinwm91drgwud,mu4jd5bqgna5,s64d6h1ji2e0d,123k831kv6wf5,1elgvvv1nk8vv3,1jdj6gp1aaoah9,1wfxemn3gvg5v,1py1xsf1iyl4bn,kh9uot3vo95d,19y5pk5yd6le1,b23usr1fbphjj,1ljcw7d495pfx,1m6w3t1aeh6h9,160qfmhj4nat9,1hzvs8j1m4gr0n,1pn96tpsxgxht,ry7hzv4o3rz,1jlh1l513mi6ot,b6l82d1pp9sjd,5r6ju01ay0es,1fqw1957op0h9,n2xuvt1oty2wd,1wg46c3qnt3k7,gxof3n1v3ouo7,hmnhfhrup641,egfdzv1gefzlb,1m9y34f1bewajn,1qzizznqf4pev,14fvmeh3659j1,1su6g231y7j167,l52h6rqkldz,1rxpt711sdbz69,fyhv078mo16j,wnvw0x12iy49x,djij9j1r0wekr,4marhn1uzbib3,1hkikop1h7qjr1,1tvuu6v1duya63,v9bhuz11z7tkf,2ov4kl5sk0ih,v2urnt1xsb4fh,lbz3hv1pk1ppj,1u5svu71qoo6zn,uxmywjhbc1br,vffuq31ukn0hb,iudhez166rxcf,y8y1r1njv1c3,zn7dhz15mahh7,1rua9kd13d59m9,rhvjojxda8mf,113n7g91qj9lq5,13lfg81pp9wol,2tah016shbol,1t3u2edo6wmih,12b0ffd7mfsil,njh07h2790s1,knnotr18v3s6b,1tbrh111i082ft,i66hu116by4gt,ugnayp6vvmut,1u51copvbv99,19nwc614mregt,f3drhd1r63g5x,7i79fz19wpnmb,sbnx0n1bpuey3,11v1ifv1kkuefz,di7vnnk9kt7b,zypxif1sa7997,z4l21fpbqimf,9dbh4b1qynsin,td96l3iw41e3,56p0jba5bn57,o472bd4yneql,oaclz3hqnl37,1prod2puek3mt,15tbto91mkf5zh,1sptmn34890qb,xav3fx1jccxkh,1flo7vt1b0s0h9,1dhr4d10l89jd,baaz7b1oufmcr,6wb425i1rcb5,rwhdon1czggyj,ucz6h11ezuiah,3xspzd1ctshh9,17ihkj915qfotl,1gi7yo51jacou1,13juygl1g9zfft,1b6j3nx1p55vlt,15qq475go6sxx,1ouzlqj1ddjcn3,kt6yc96t2zod,p4j49pbalz4h,3h34gn1tgvmu3,a4dj2d1wu2ic9,rkxd8v15vemjn,1kdqt9b17t6ynn,1d1udyj1fre9ov,brusxbxh0d4z,16id56i1ui2ncu,mklsdl19e6c8t,1hckhfb15jjkh7,1x0xykhxp5jfp,1ahkfxb167o74j,18qkg0hbenp3p,d89169e6jb0l,1imvk6l1guvy41,1p365ht1ah2vz9,11znqs54gvwp,60pesrksnvov,1huk801hpubb9,z1ogl9et535,1gel1d7o97ce7,wpysktw2yao1,i5xhv71sa7u47,ikm1fb1r7enjv,bmu76119wv90t,kcduih1ow6vt9,tan95zdw8863,3h15ts1ybfc2c,15u8p0x9ftrit,1q2rl531jy8hn,16pyri11d6p0wd,30axvp1tf87ix,1wgg0ctc3ehvl,rhcwa7trmexv,yudqktpsxfe9,1bmievpryu8sp,miesf3wu89n7,1kr5cs11xeh2ud';

  const steps = {
    /** v1 → v2: stars/best by level number become progress by puzzle id; tutorial split out. */
    1(d, C) {
      const ids = V1_LEVEL_IDS.split(',');
      const progress = {};
      for (const n of Object.keys(d.stars || {})) {
        const id = ids[+n - 1];
        if (!id) continue;
        progress[id] = { stars: d.stars[n] };
        if (d.best && d.best[n]) progress[id].best = d.best[n];
      }
      d.progress = progress;
      d.tutorialDone = Object.keys(progress).length > 0;
      if (d.session && d.session.puzzle) {
        if (d.session.mode === 'campaign') d.session.puzzle.id = C.puzzleId(d.session.puzzle.tubes, d.session.puzzle.cap);
      }
      delete d.stars; delete d.best; delete d.unlocked;
      return d;
    },
  };

  /** Upgrade saved data to the current schema. Unknown future versions are left alone. */
  function migrate(d, C) {
    let v = d.v || 1;
    while (v < SCHEMA && steps[v]) { d = steps[v](d, C); v++; }
    d.v = v;
    return d;
  }

  const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  /** Consecutive days in `done` ending at `last` (YYYY-MM-DD). */
  function streakTo(done, last) {
    if (!last || !done[last]) return 0;
    const [y, m, d] = last.split('-').map(Number);
    const day = new Date(y, m - 1, d);
    let n = 0;
    while (done[dayKey(day)]) { n++; day.setDate(day.getDate() - 1); }
    return n;
  }

  /**
   * Combine this device's save (`a`) with the account's (`b`), both migrated.
   * Solves are never lost: stars and daily results are unioned, endless
   * follows whichever side has played more, and the unfinished puzzle is the
   * one touched last. Settings stay per device.
   *
   * A reset made while signed in is recorded as `resetAt`. A device that
   * synced with this account (`user`) before that reset holds stale progress,
   * so the account's copy replaces it instead of merging.
   */
  function merge(a, b, user) {
    if (!b) return a;
    if ((b.resetAt || 0) > (a.resetAt || 0) && a.syncedAs === user) return Object.assign({}, b, { settings: a.settings });
    const out = Object.assign({}, b, a);
    out.v = Math.max(a.v || 1, b.v || 1);
    out.resetAt = Math.max(a.resetAt || 0, b.resetAt || 0) || undefined;

    out.progress = {};
    for (const src of [a.progress || {}, b.progress || {}]) {
      for (const id of Object.keys(src)) {
        const r = src[id], m = out.progress[id] || (out.progress[id] = {});
        if (r.stars) m.stars = Math.max(m.stars || 0, r.stars);
        if (r.best) m.best = Math.min(m.best || Infinity, r.best);
      }
    }
    out.tutorialDone = !!(a.tutorialDone || b.tutorialDone);
    if (a.newSince != null && b.newSince != null) out.newSince = Math.min(a.newSince, b.newSince);
    if (a.newsSeen != null && b.newsSeen != null) out.newsSeen = Math.max(a.newsSeen, b.newsSeen);

    const ea = a.endless || {}, eb = b.endless || {};
    const played = (eb.solved || 0) > (ea.solved || 0) ? eb : ea;
    out.endless = Object.assign({}, eb, ea, { auto: played.auto, solved: played.solved, streak: played.streak });

    const da = a.daily || {}, db = b.daily || {};
    const done = Object.assign({}, db.done);
    for (const k of Object.keys(da.done || {})) done[k] = Math.max(done[k] || 0, da.done[k]);
    const late = Object.assign({}, db.late);
    for (const k of Object.keys(da.late || {})) late[k] = Math.max(late[k] || 0, da.late[k]);
    for (const k of Object.keys(done)) delete late[k]; // solved on the day somewhere: that wins
    const last = (da.last || '') > (db.last || '') ? da.last : db.last || da.last || '';
    const sides = [da, db].filter((d) => d.last === last).map((d) => d.streak || 0);
    out.daily = { done, late, last, streak: Math.max(streakTo(done, last), ...sides, 0) };

    const s = (b.sessionAt || 0) > (a.sessionAt || 0) ? b : a;
    out.session = s.session || null;
    out.sessionAt = s.sessionAt;
    out.settings = a.settings;
    return out;
  }

  root.SortSave = { SCHEMA, migrate, merge };
})(typeof self !== 'undefined' ? self : this);
