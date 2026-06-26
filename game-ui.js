/*
 * game-ui.js - DOM, tap-to-place, rendering, and the game loop.
 * Depends on the global `Core` (game-core.js). No grading lives here.
 *
 * Topping rendering: each topping has a full-pizza PNG (scattered pieces on a
 * transparent background, assets/toppings/<id>.png). Per wedge we draw that PNG
 * clipped to the wedge, so toppings line up like a real pizza and several can
 * stack on one slice (gaps are transparent). Falls back to emoji if a PNG is
 * missing, so the game is playable before art is generated.
 */
(function () {
  'use strict';
  var C = window.Core;
  var SVGNS = 'http://www.w3.org/2000/svg';
  var XLINK = 'http://www.w3.org/1999/xlink';

  // geometry in a 0..360 viewBox (the SVG is displayed larger than that).
  var CX = 180, CY = 180, R = 150;
  function pt(a) { var r = a * Math.PI / 180; return [CX + R * Math.sin(r), CY - R * Math.cos(r)]; }
  function wedgePath(i) {
    var p0 = pt(45 * i), p1 = pt(45 * (i + 1));
    return 'M' + CX + ',' + CY + ' L' + p0[0] + ',' + p0[1] +
      ' A' + R + ',' + R + ' 0 0 1 ' + p1[0] + ',' + p1[1] + ' Z';
  }
  function wedgeCentroid(i, f) { var a = (45 * i + 22.5) * Math.PI / 180, rr = R * (f || 0.62); return [CX + rr * Math.sin(a), CY - rr * Math.cos(a)]; }
  function wedgeAt(clientX, clientY, svg) {
    svg = svg || el('pizza');
    var rect = svg.getBoundingClientRect();
    var x = (clientX - rect.left) / rect.width * 360, y = (clientY - rect.top) / rect.height * 360;
    var dx = x - CX, dy = y - CY;
    if (Math.sqrt(dx * dx + dy * dy) > R) return -1;
    var ang = Math.atan2(dx, -dy) * 180 / Math.PI; if (ang < 0) ang += 360;
    return Math.floor(ang / 45) % 8;
  }

  function el(id) { return document.getElementById(id); }
  function show(id) { el(id).classList.add('show'); }
  function hide(id) { el(id).classList.remove('show'); }

  // ---- persistent state ----
  var LS = {
    get high() { return +(localStorage.getItem('pizzashop.highscore') || 0); },
    set high(v) { localStorage.setItem('pizzashop.highscore', v); },
    get meme() { return localStorage.getItem('pizzashop.meme') !== 'off'; },
    set meme(v) { localStorage.setItem('pizzashop.meme', v ? 'on' : 'off'); },
    get muted() { return localStorage.getItem('pizzashop.muted') === 'on'; },
    set muted(v) { localStorage.setItem('pizzashop.muted', v ? 'on' : 'off'); },
    get seen() { try { return JSON.parse(localStorage.getItem('pizzashop.seen') || '[]'); } catch (e) { return []; } },
    set seen(v) { localStorage.setItem('pizzashop.seen', JSON.stringify(v)); },
    // recipes the player has already had defined for them (scaffold-then-fade)
    get taught() { try { return JSON.parse(localStorage.getItem('pizzashop.taught') || '[]'); } catch (e) { return []; } },
    set taught(v) { localStorage.setItem('pizzashop.taught', JSON.stringify(v)); },
    get difficulty() { var v = parseFloat(localStorage.getItem('pizzashop.difficulty')); return (isFinite(v) && v >= 1) ? v : 1; },
    set difficulty(v) { localStorage.setItem('pizzashop.difficulty', v); }
  };

  var S = null;
  function newRun() {
    S = { money: 20, served: 0, aura: 0, order: null, layout: C.emptyLayout(),
      brush: null, tipDeadline: 0, tipWindowMs: 0, tipTimer: null, lastKey: null,
      patienceDeadline: 0, patienceWindowMs: 0, patienceTimer: null,
      featureNext: null, difficulty: LS.difficulty, maxStreak: 0, won: false };
  }

  // ---- ingredient unlock: grows with orders served AND current difficulty ----
  function unlockedFor(served) {
    // Ingredients scale with the DIFFICULTY being played, not the order count, so a
    // returning high-level player has the right kitchen straight away (and a fresh
    // player still meets ingredients one level at a time as they climb).
    var diff = S ? S.difficulty : 1;
    var count = Math.min(C.UNLOCK_ORDER.length, 4 + Math.round(diff));
    return C.UNLOCK_ORDER.slice(0, count);
  }
  function toppingsUnlocked(served) { return unlockedFor(served).filter(function (id) { return C.TOPPING[id]; }); }
  function basesUnlocked(served) {
    var u = unlockedFor(served), bases = ['tomato']; // tomato base available from the start
    if (u.indexOf('cheese-base') !== -1) bases.push('cheese');
    if (u.indexOf('bbq-base') !== -1) bases.push('bbq');
    return bases;
  }

  // ---- topping image preload ----
  var IMG_OK = {};
  // bases that ship a seamless sauce/cheese texture (no crust); 'plain' stays bare
  // dough and never gets an image.
  var BASE_IMG = ['tomato', 'cheese', 'bbq'];
  var BASE_IMG_OK = {};
  function preloadArt() {
    Object.keys(C.TOPPING).forEach(function (id) {
      var im = new Image();
      im.onload = function () { IMG_OK[id] = true; if (S && S.order) renderPizza(); };
      im.src = 'assets/toppings/' + id + '.png';
    });
    BASE_IMG.forEach(function (id) {
      var im = new Image();
      im.onload = function () { BASE_IMG_OK[id] = true; if (S && S.order) renderPizza(); };
      im.src = 'assets/bases/' + id + '.png';
    });
  }

  // =========================================================================
  // Pizza rendering (shared by the main pizza and the small compare previews)
  // =========================================================================
  var clipSeq = 0;
  function drawPizza(svg, layout, prefix, sizePx) {
    svg.setAttribute('width', sizePx); svg.setAttribute('height', sizePx);
    svg.setAttribute('viewBox', '0 0 360 360');
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    var defs = document.createElementNS(SVGNS, 'defs'); svg.appendChild(defs);

    // base wedges. A wedge with a textured base (tomato/cheese/bbq) gets the
    // base PNG clipped to its slice; everything else (plain dough, wildcard, or a
    // missing texture file) falls back to the flat colour fill so the game stays
    // playable without art.
    for (var i = 0; i < 8; i++) {
      var s = layout[i];
      var path = document.createElementNS(SVGNS, 'path');
      path.setAttribute('d', wedgePath(i));
      path.setAttribute('class', 'wedge');
      path.dataset.i = i;
      path.setAttribute('fill', s.wildcard ? '#e8e8e8' : C.BASES[s.base].color);
      svg.appendChild(path);
      if (!s.wildcard && BASE_IMG_OK[s.base]) wedgeBaseImage(svg, defs, i, s.base, prefix);
    }
    // toppings: scatter several single-piece images across each wedge so a slice
    // clearly shows multiple toppings at once
    for (i = 0; i < 8; i++) {
      var sl = layout[i];
      if (sl.wildcard) { centreText(svg, i, '❓'); continue; }
      var total = sl.toppings.length;
      sl.toppings.forEach(function (t, ti) { scatterTopping(svg, i, t, ti, total); });
    }
    // crust ring on top. Set presentation attributes directly: the `fill:none`
    // CSS rule is scoped to `#pizza .crust`, so the compare previews (no #pizza id)
    // would otherwise paint a solid black disc over the toppings.
    var crust = document.createElementNS(SVGNS, 'circle');
    crust.setAttribute('cx', CX); crust.setAttribute('cy', CY); crust.setAttribute('r', R);
    crust.setAttribute('class', 'crust');
    crust.setAttribute('fill', 'none');
    crust.setAttribute('stroke', '#e0a85a'); // --crust
    crust.setAttribute('stroke-width', 14);
    svg.appendChild(crust);
  }
  // Draw the seamless base texture for one wedge by clipping an <image> to the
  // wedge path. Each wedge needs its own clipPath id (unique across all SVGs).
  function wedgeBaseImage(svg, defs, i, base, prefix) {
    var id = 'wbc-' + (prefix || 'p') + '-' + (clipSeq++);
    var cp = document.createElementNS(SVGNS, 'clipPath');
    cp.setAttribute('id', id);
    var cpath = document.createElementNS(SVGNS, 'path');
    cpath.setAttribute('d', wedgePath(i));
    cp.appendChild(cpath); defs.appendChild(cp);
    var im = document.createElementNS(SVGNS, 'image');
    im.setAttributeNS(XLINK, 'href', 'assets/bases/' + base + '.png');
    im.setAttribute('href', 'assets/bases/' + base + '.png');
    // cover the whole pizza disc so the texture lines up across slices
    im.setAttribute('x', CX - R); im.setAttribute('y', CY - R);
    im.setAttribute('width', R * 2); im.setAttribute('height', R * 2);
    im.setAttribute('preserveAspectRatio', 'xMidYMid slice');
    im.setAttribute('clip-path', 'url(#' + id + ')');
    svg.appendChild(im);
  }
  // Deterministic 0..1 hash so a given (wedge, topping-index, piece, salt) always
  // lands in the same spot: the scatter is stable across re-renders but still
  // looks random. A plain LCG-style scramble of the inputs.
  function rand01(i, ti, p, salt) {
    var n = (i * 73856093) ^ (ti * 19349663) ^ (p * 83492791) ^ (salt * 2654435761);
    n = (n ^ (n >>> 13)) >>> 0;
    n = (n * 1274126177) >>> 0;
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  }
  // A point somewhere inside wedge `i`, covering the WHOLE slice from near the
  // pizza centre out to just inside the crust, with random jitter so pieces look
  // naturally scattered rather than sitting on rings. Keeps a margin off the
  // wedge's two straight edges and off the crust so pieces stay inside the slice.
  function wedgePoint(i, ti, p) {
    // radius: sqrt() so points spread by area, not bunched near the centre; min
    // is small so the slice centre actually gets used.
    var u = rand01(i, ti, p, 1);
    var rr = R * (0.14 + Math.sqrt(u) * 0.70); // ~0.14R .. 0.84R from centre
    // angle: across the 45° span, but narrow the usable arc near the tip (small
    // rr) so a piece near the centre can't poke out of the straight edges.
    var frac = rr / R;
    var margin = 7 * (1 - frac) + 4 * frac; // degrees of edge clearance
    var lo = 45 * i + margin, hi = 45 * (i + 1) - margin;
    var v = rand01(i, ti, p, 2);
    var a = (lo + (hi - lo) * v) * Math.PI / 180;
    return [CX + rr * Math.sin(a), CY - rr * Math.cos(a)];
  }
  function scatterTopping(svg, i, t, ti, total) {
    var pieces = total <= 1 ? 5 : (total === 2 ? 3 : 2);
    for (var p = 0; p < pieces; p++) {
      var xy = wedgePoint(i, ti, p);
      var rot = Math.floor(rand01(i, ti, p, 3) * 360);
      placePiece(svg, xy[0], xy[1], t, 44, rot);
    }
  }
  function placePiece(svg, x, y, t, size, rot) {
    if (IMG_OK[t]) {
      var im = document.createElementNS(SVGNS, 'image');
      im.setAttributeNS(XLINK, 'href', 'assets/toppings/' + t + '.png');
      im.setAttribute('href', 'assets/toppings/' + t + '.png');
      im.setAttribute('x', x - size / 2); im.setAttribute('y', y - size / 2);
      im.setAttribute('width', size); im.setAttribute('height', size);
      im.setAttribute('transform', 'rotate(' + rot + ' ' + x + ' ' + y + ')');
      svg.appendChild(im);
    } else {
      centreTextAt(svg, x, y, C.TOPPING[t] ? C.TOPPING[t].icon : '?');
    }
  }
  function centreText(svg, i, txt) { var c = wedgeCentroid(i, 0.6); centreTextAt(svg, c[0], c[1], txt); }
  function centreTextAt(svg, x, y, txt) {
    var tn = document.createElementNS(SVGNS, 'text');
    tn.setAttribute('class', 'top'); tn.setAttribute('x', x); tn.setAttribute('y', y);
    tn.textContent = txt; svg.appendChild(tn);
  }

  function renderPizza() { drawPizza(el('pizza'), S.layout, 'main', 470); attachPizzaHandlers(); }

  // ---- per-level shop scene: swap the body backdrop to match the order's tier.
  // Robust to a missing per-tier file: preload via Image() and only switch once it
  // loads; on error we leave the current/default background (never blank it). The
  // current tier is tracked so the same scene isn't re-set every order.
  var sceneTier = 0;
  function setScene(tier) {
    var t = Math.max(1, Math.min(C.MAX_TIER, Math.round(tier || 1)));
    if (t === sceneTier) return;
    sceneTier = t;
    var src = 'assets/scene/shop-' + t + '.png';
    var im = new Image();
    im.onload = function () {
      // guard against a stale load if the tier changed again before this fired
      if (sceneTier !== t) return;
      document.body.style.backgroundImage =
        'linear-gradient(rgba(20,10,0,.25), rgba(20,10,0,.35)), url(' + src + ')';
    };
    im.onerror = function () { /* missing per-tier art: keep the default shop.png */ };
    im.src = src;
  }

  var handlersAttached = false;
  function attachPizzaHandlers() {
    if (handlersAttached) return;
    handlersAttached = true;
    var svg = el('pizza');
    svg.addEventListener('pointerdown', onPizzaTap);
    svg.addEventListener('pointermove', onPizzaHover);
    svg.addEventListener('pointerleave', function () { highlight(-1); });
  }
  function highlight(w) {
    Array.prototype.slice.call(el('pizza').querySelectorAll('path.wedge')).forEach(function (p) {
      p.classList.toggle('hover', +p.dataset.i === w);
    });
  }
  function onPizzaHover(e) { if (S && S.brush) highlight(wedgeAt(e.clientX, e.clientY)); }

  // =========================================================================
  // Tray + brush (tap a chip to pick it up, tap slices to place)
  // =========================================================================
  function buildTray() {
    var bg = el('base-group');
    var bc = el('base-chips'); bc.innerHTML = '';
    basesUnlocked(S.served).forEach(function (b) { bc.appendChild(chip('base', b, baseLabel(b), baseIcon(b), false)); });
    bg.style.display = bc.children.length ? 'block' : 'none';

    var tc = el('topping-chips'); tc.innerHTML = '';
    // show the shelf alphabetically by name so it's easy to find an ingredient.
    toppingsUnlocked(S.served).slice()
      .sort(function (a, b) { return C.TOPPING[a].name.localeCompare(C.TOPPING[b].name); })
      .forEach(function (id) {
        var info = C.TOPPING[id];
        tc.appendChild(chip('topping', id, info.name, iconHtml(id, info.icon), !!info.novelty));
      });
    reflectBrush();
  }
  function iconHtml(id, emoji) {
    if (IMG_OK[id]) return '<img src="assets/toppings/' + id + '.png" alt="">';
    return emoji;
  }
  function baseLabel(b) { return b === 'tomato' ? 'Tomato' : (b === 'cheese' ? 'Cheese' : 'BBQ'); }
  function baseIcon(b) { return b === 'tomato' ? '🍅' : (b === 'cheese' ? '🧀' : '🟤'); }

  function chip(kind, id, label, iconInner, novelty) {
    var d = document.createElement('div');
    d.className = 'chip ' + kind + (novelty ? ' novelty' : '');
    d.dataset.kind = kind; d.dataset.id = id;
    d.innerHTML = '<span class="ic">' + iconInner + '</span><span>' + label + '</span>';
    d.addEventListener('pointerdown', function (e) { e.preventDefault(); selectBrush(kind, id); });
    return d;
  }
  function selectBrush(kind, id) {
    Snd.pick();
    if (S.brush && S.brush.kind === kind && S.brush.id === id) S.brush = null; // toggle off
    else S.brush = { kind: kind, id: id };
    el('eraser-btn').classList.remove('on');
    reflectBrush();
  }
  function reflectBrush() {
    Array.prototype.slice.call(document.querySelectorAll('.chip')).forEach(function (c) {
      var on = S && S.brush && S.brush.kind === c.dataset.kind && S.brush.id === c.dataset.id;
      c.classList.toggle('selected', !!on);
    });
  }

  function onPizzaTap(e) {
    if (!S) return;
    var w = wedgeAt(e.clientX, e.clientY);
    if (w < 0) return;
    var slice = S.layout[w];
    if (!S.brush) { flashHint('Pick a topping or base from the shelf first!'); return; }
    if (S.brush.kind === 'eraser') {
      if (slice.toppings.length) slice.toppings = slice.toppings.slice(0, -1);
      else slice.base = 'plain';
      Snd.erase();
    } else if (S.brush.kind === 'base') {
      slice.base = S.brush.id;
      Snd.place();
    } else { // topping
      // base-first is a training wheel for the early levels only. From level 6 on,
      // the player may place a topping on a bare slice — and forgetting the base
      // will simply lose marks at grading time.
      if (slice.base === 'plain' && Math.round(S.difficulty || 1) <= 5) { flashHint('Put a base on this slice first! 🍅'); return; }
      var ti = slice.toppings.indexOf(S.brush.id);
      if (ti === -1) { slice.toppings = slice.toppings.concat([S.brush.id]).sort(); Snd.place(); }
      else { slice.toppings.splice(ti, 1); Snd.erase(); } // tap again to remove
    }
    renderPizza();
  }
  var hintTimer = null;
  function flashHint(text) {
    var h = el('hint'); h.textContent = text; h.classList.add('show');
    if (hintTimer) clearTimeout(hintTimer);
    hintTimer = setTimeout(function () { h.classList.remove('show'); }, 1400);
  }

  // =========================================================================
  // Game loop
  // =========================================================================
  function startGame() {
    newRun(); hide('start-overlay'); refreshHud(); renderPizza(); nextOrder();
  }
  function refreshHud() {
    el('money').textContent = S ? S.money : 20;
    el('served').textContent = S ? S.served : 0;
    el('aura').textContent = S ? S.aura : 0;
    el('highscore').textContent = LS.high;
    el('meme-toggle').textContent = 'Meme mode: ' + (LS.meme ? 'ON' : 'OFF');
    el('mute-toggle').textContent = LS.muted ? '🔇 Sound off' : '🔊 Sound on';
  }

  function pendingIntros() {
    var unlocked = unlockedFor(S.served), seen = LS.seen, out = [];
    unlocked.forEach(function (id) { if (seen.indexOf(id) === -1) out.push(id); });
    return out;
  }
  function markSeen(ids) { var seen = LS.seen; ids.forEach(function (id) { if (seen.indexOf(id) === -1) seen.push(id); }); LS.seen = seen; }
  function introCardData(id) {
    if (id === 'cheese-base') return { emoji: '🧀', title: 'New base: Cheese!', text: 'You can now lay a cheese base. Bases go on before toppings!' };
    if (id === 'bbq-base') return { emoji: '🟤', title: 'New base: BBQ sauce!', text: 'A smoky BBQ base is now in the kitchen.' };
    var info = C.TOPPING[id];
    return { emoji: info.icon, title: 'New ingredient: ' + info.name + '!', text: info.novelty ? 'A wild one! Someone will definitely ask for it.' : 'It’s now on your topping shelf.' };
  }
  function nextOrder() {
    buildTray();
    var pend = pendingIntros();
    // If a topping was just introduced, feature it in the next order (bases can't
    // be forced via `require`, which keys off toppings). Last one wins.
    pend.forEach(function (id) { if (C.TOPPING[id]) S.featureNext = id; });
    showIntros(pend, beginOrder);
  }
  function showIntros(ids, done) {
    if (!ids.length) { done(); return; }
    var id = ids[0], data = introCardData(id);
    Snd.fanfare();
    el('intro-emoji').textContent = data.emoji;
    el('intro-title').textContent = data.title;
    el('intro-text').textContent = data.text;
    show('intro-overlay');
    el('intro-btn').onclick = function () { hide('intro-overlay'); markSeen([id]); buildTray(); showIntros(ids.slice(1), done); };
  }

  function beginOrder() {
    var unlocked = unlockedFor(S.served);
    // If a topping was just introduced, force the next order to use it once.
    var require = (S.featureNext && C.TOPPING[S.featureNext]) ? S.featureNext : null;
    S.order = C.generateOrder({ ordersServed: S.served, unlocked: unlocked, difficulty: S.difficulty, avoidKey: S.lastKey, require: require, taught: LS.taught });
    S.featureNext = null; // used once, whether or not it landed
    // Once a recipe has been defined in an order, mark it taught so future orders
    // name it bare (the player must then recall the ingredients themselves).
    if (S.order.teach && S.order.teach.names) {
      var tg = LS.taught;
      S.order.teach.names.forEach(function (n) { if (tg.indexOf(n) === -1) tg.push(n); });
      LS.taught = tg;
    }
    S.lastKey = S.order.key;
    S.layout = C.emptyLayout();
    S.brush = null;
    renderPizza(); reflectBrush();

    var cust = C.CAST[Math.floor(Math.random() * C.CAST.length)];
    el('cust-name').textContent = cust.name;
    setAvatar(cust);
    S.order._cust = cust;

    el('bubble').textContent = S.order.text;
    el('tier-pill').style.display = 'inline-block';
    el('tier-pill').textContent = 'Level ' + S.order.tier;
    setScene(S.order.tier);

    startTipTimer(S.order);
    startPatienceTimer(S.order);
  }
  function setAvatar(cust) {
    var box = el('avatar'), img = new Image();
    img.onload = function () { img.className = 'avatar'; img.id = 'avatar'; box.replaceWith(img); };
    img.onerror = function () {
      var faces = ['😀', '😄', '🤓', '😋', '🧑‍🍳', '👵', '🦖', '🧙', '🐊', '🦈'];
      box.className = 'avatar placeholder'; box.id = 'avatar';
      box.textContent = faces[Math.abs(hashStr(cust.id)) % faces.length];
    };
    img.src = 'assets/customers/' + cust.id + '.png';
  }
  function hashStr(s) { var h = 0; for (var i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; }

  // ---- tip countdown: scaled to how many taps the order needs ----
  function countTaps(layout) {
    var taps = 0;
    for (var i = 0; i < 8; i++) {
      var s = layout[i];
      if (s.wildcard) { taps += 2; continue; }
      if (s.base !== 'plain') taps += 1;
      // category-count slices ("any 3 meats") carry a count, not a toppings array.
      if (s.catCount) { taps += s.count; continue; }
      taps += s.toppings.length;
    }
    return taps;
  }
  function startTipTimer(order) {
    var taps = countTaps(order.acceptable[0]);
    // Scales with the work, but capped at 60s (the tip must feel earned).
    S.tipWindowMs = Math.min(60000, Math.max(18000, Math.round((8 + taps * 1.9) * 1000)));
    S.tipDeadline = Date.now() + S.tipWindowMs;
    var wrap = el('tipbar-wrap'); wrap.classList.remove('gone', 'amber');
    if (S.tipTimer) clearInterval(S.tipTimer);
    S.tipTimer = setInterval(tickTip, 100); tickTip();
  }
  function tickTip() {
    var left = S.tipDeadline - Date.now(), frac = Math.max(0, left / S.tipWindowMs);
    el('tipbar').style.width = (frac * 100) + '%';
    var wrap = el('tipbar-wrap');
    if (left <= 0) { Snd.tipLost(); el('tip-label').textContent = '💲1 tip: gone'; wrap.classList.add('gone'); clearInterval(S.tipTimer); S.tipTimer = null; }
    else { el('tip-label').textContent = '💲1 tip: ' + Math.ceil(left / 1000) + 's'; wrap.classList.toggle('amber', left <= 4000); }
  }
  function stopTipTimer() { if (S.tipTimer) { clearInterval(S.tipTimer); S.tipTimer = null; } }

  // ---- patience timer: how long the customer waits before getting annoyed and
  // leaving. Created from JS (no markup in game.html) and sat under the tip bar.
  // The window is generous and grows with order complexity so it's fair for a
  // young child; running it out costs the $3 make-cost and skips the customer.
  var patienceBuilt = false;
  function buildPatienceBar() {
    if (patienceBuilt) return;
    patienceBuilt = true;
    var kitchen = el('kitchen'), tipWrap = el('tipbar-wrap');
    var wrap = document.createElement('div');
    wrap.id = 'patience-wrap';
    wrap.title = 'How long this customer will wait!';
    wrap.style.cssText = 'width:320px;height:22px;background:#eee;border-radius:999px;' +
      'overflow:hidden;position:relative;box-shadow:inset 0 2px 4px rgba(0,0,0,.15);';
    var bar = document.createElement('div');
    bar.id = 'patiencebar';
    bar.style.cssText = 'height:100%;width:100%;background:linear-gradient(90deg,#7ed957,#2aa877);transition:width .25s linear;';
    var label = document.createElement('div');
    label.id = 'patience-label';
    label.style.cssText = 'position:absolute;inset:0;display:grid;place-items:center;font-weight:800;font-size:.8rem;color:#1b5e3a;';
    wrap.appendChild(bar); wrap.appendChild(label);
    // place it directly after the tip bar
    if (tipWrap && tipWrap.parentNode === kitchen) kitchen.insertBefore(wrap, tipWrap.nextSibling);
    else kitchen.appendChild(wrap);
  }
  // How many distinct regions the order paints -> more regions = more time.
  function countRegions(layout) {
    var seen = {}, regions = 0;
    for (var i = 0; i < 8; i++) {
      var s = layout[i];
      var key = s.wildcard ? 'wild' : (s.catCount ? ('cat:' + s.cat + s.count + '|' + s.base) : (s.base + '|' + s.toppings.join(',')));
      if (!seen[key]) { seen[key] = 1; regions++; }
    }
    return regions;
  }
  function startPatienceTimer(order) {
    buildPatienceBar();
    var taps = countTaps(order.acceptable[0]);
    var regions = countRegions(order.acceptable[0]);
    // generous floor, plus time per tap and a big bonus per extra region.
    S.patienceWindowMs = Math.round((30 + taps * 2.5 + (regions - 1) * 12) * 1000);
    S.patienceDeadline = Date.now() + S.patienceWindowMs;
    var wrap = el('patience-wrap'); wrap.classList.remove('low');
    if (S.patienceTimer) clearInterval(S.patienceTimer);
    S.patienceTimer = setInterval(tickPatience, 100); tickPatience();
  }
  function tickPatience() {
    var left = S.patienceDeadline - Date.now(), frac = Math.max(0, left / S.patienceWindowMs);
    var bar = el('patiencebar'); if (bar) bar.style.width = (frac * 100) + '%';
    var label = el('patience-label');
    if (left <= 0) { stopPatienceTimer(); customerLeaves(); return; }
    if (label) label.textContent = '😊 waiting: ' + Math.ceil(left / 1000) + 's';
    if (bar && left <= 8000) bar.style.background = 'linear-gradient(90deg,#ff9d3c,#ff6a00)';
  }
  function stopPatienceTimer() { if (S.patienceTimer) { clearInterval(S.patienceTimer); S.patienceTimer = null; } }

  // ---- box it ----
  function rewardBase(tier) { return 4 + 0.5 * (tier - 1); } // tier1~$4 .. tier20~$13.5
  // Adaptive difficulty IS the level. It is driven only by performance, never by
  // how many pizzas have been served:
  //   - finish fast AND accurately (you earn the speed tip) -> level UP
  //   - get it accurate but too slow for the tip -> hold this level
  //   - refused (acc < 0.8) or the customer timed out and left -> level DOWN
  // `tip` is true only when the pizza was both accepted and fast (see boxIt). The
  // up-step is large so a quick learner climbs in a few pizzas, not twenty.
  // Persisted so a returning child resumes exactly at their level.
  function adjustDifficulty(acc, tip) {
    var d = S.difficulty;
    if (tip) d += 0.7;             // fast + accurate: this is the only way up
    else if (acc < 0.8) d -= 0.8;  // refused, or walked out (acc 0): drop a level
    d = Math.max(1, Math.min(C.MAX_TIER + 0.99, d));
    S.difficulty = d; LS.difficulty = d;
  }
  function boxIt() {
    if (!S || !S.order) return;
    Snd.box();
    var fast = (Date.now() <= S.tipDeadline);
    stopTipTimer(); stopPatienceTimer();
    var res = C.grade(S.layout, S.order.acceptable), acc = res.accuracy, tier = S.order.tier;
    // Below 0.8 accuracy the customer refuses the pizza: no pay, player still eats
    // the $3 make-cost.
    var refused = acc < 0.8;
    var reward = refused ? 0 : Math.round(rewardBase(tier) * acc);
    var tip = (!refused && fast) ? 1 : 0; // refused already requires acc>=0.8
    S.money += -3 + reward + tip;
    // Refused pizzas (acc < 0.8) cost aura; accepted ones earn it.
    S.aura += acc >= 1 ? 1000 : (acc >= 0.8 ? 250 : -500);
    if (S.money > LS.high) LS.high = S.money;
    adjustDifficulty(acc, tip);
    // Mastery streak: tipped pizzas served at the very top level. Anything that
    // isn't a tipped top-level pizza breaks the run.
    if (tier >= C.MAX_TIER && tip) S.maxStreak += 1; else S.maxStreak = 0;
    var victory = (S.maxStreak >= 5 && !S.won);
    if (victory) S.won = true;
    refreshHud();
    if (reward + tip > 0) kaching(reward + tip);
    if (S.order._cust && S.order._cust.gag === 'sixseven') banner67();
    showResult(acc, reward, tip, refused, res.closest);
    if (victory) { if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; } showVictory(); }
  }

  // Patience ran out: the customer gives up and leaves. No pizza is graded; the
  // player still loses the $3 of dough they spent.
  function customerLeaves() {
    if (!S || !S.order) return;
    stopTipTimer();
    S.money += -3;
    S.aura += -500;
    if (S.money > LS.high) LS.high = S.money;
    adjustDifficulty(0, false);
    refreshHud();
    showLeftResult();
  }
  function showLeftResult() {
    Snd.fail();
    el('result-title').textContent = '😠 They got bored and left!';
    el('result-reaction').textContent = '“' + C.pickReaction('left', LS.meme) + '”';
    el('result-money').innerHTML = '−$3 of dough wasted ⇒ <span class="minus">−$3</span> (no pizza sold)';
    var compare = el('result-compare'), ul = el('result-mistakes');
    compare.innerHTML = ''; ul.innerHTML = '';
    compare.style.display = 'none'; ul.style.display = 'none';
    el('next-btn').textContent = 'Next customer ▶';
    show('result-overlay');
    autoAdvance(3500);
  }

  function showResult(acc, reward, tip, refused, closest) {
    var mistakes = C.describeMistakes(S.layout, closest);
    var band = C.reactionBand(acc);
    // celebratory / sympathetic sting, slightly after the coin so they don't muddy.
    setTimeout(refused ? Snd.fail : (acc >= 1 ? Snd.perfect : (band === 'great' ? Snd.success : Snd.meh)), 180);
    var line = (S.order.novelty && acc >= 0.8) ? C.pickReaction('incredulity', LS.meme) : C.pickReaction(band, LS.meme);

    el('result-title').textContent = refused ? '😤 Order refused!' : (acc >= 1 ? '⭐ Perfect!' : '📦 Order up!');
    el('result-reaction').textContent = '“' + line + '”';

    var parts = ['−$3 to make'];
    if (reward) parts.push('+$' + reward + ' paid');
    if (tip) parts.push('+$1 speedy tip');
    if (refused) parts.push('paid nothing');
    var net = reward + tip - 3;
    el('result-money').innerHTML = parts.join(' · ') + ' ⇒ <span class="' + (net >= 0 ? 'plus' : 'minus') + '">' +
      (net >= 0 ? '+' : '−') + '$' + Math.abs(net) + '</span> (' + Math.round(acc * 100) + '% correct)';

    // Only explain the pizza when there was a mistake.
    var compare = el('result-compare'), ul = el('result-mistakes');
    compare.innerHTML = ''; ul.innerHTML = '';
    if (mistakes.length === 0) {
      compare.style.display = 'none'; ul.style.display = 'none';
      show('result-overlay');
      // quick win: auto-advance unless the player clicks first. Long enough to
      // read the reaction before it disappears.
      el('next-btn').textContent = 'Next customer ▶';
      autoAdvance(3500);
    } else {
      compare.style.display = 'flex'; ul.style.display = 'block';
      compare.appendChild(miniFig('What you made', S.layout));
      compare.appendChild(miniFig('What they wanted', closest));
      mistakes.forEach(function (m) {
        var li = document.createElement('li');
        li.textContent = '• On ' + m.where + ', they wanted ' + describeSlice(m.wantBase, m.wantToppings) + '.';
        ul.appendChild(li);
      });
      el('next-btn').textContent = 'Next customer ▶';
      show('result-overlay');
    }
  }
  var autoTimer = null;
  function autoAdvance(ms) { if (autoTimer) clearTimeout(autoTimer); autoTimer = setTimeout(function () { if (el('result-overlay').classList.contains('show')) nextCustomer(); }, ms); }
  function describeSlice(baseName, toppings) {
    var t = toppings.length ? toppings.join(' + ') : 'no toppings';
    return baseName.toLowerCase() + ' with ' + t;
  }
  function miniFig(label, layout) {
    var fig = document.createElement('figure');
    var svg = document.createElementNS(SVGNS, 'svg');
    drawPizza(svg, layout, label === 'What you made' ? 'made' : 'want', 150);
    fig.appendChild(svg);
    var cap = document.createElement('figcaption'); cap.textContent = label; fig.appendChild(cap);
    return fig;
  }

  function nextCustomer() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    hide('result-overlay');
    S.served += 1; refreshHud();
    if (S.money < 3) { gameOver(); return; }
    nextOrder();
  }
  // A friendly title for how far the player climbed (drives the game-over screen).
  function chefRank(lvl) {
    if (lvl >= 18) return '👑 Master Pizzaiolo';
    if (lvl >= 14) return '🌟 Head Chef';
    if (lvl >= 10) return '🍕 Pizza Pro';
    if (lvl >= 6) return '🧑‍🍳 Sous Chef';
    if (lvl >= 3) return '🥄 Apprentice Cook';
    return '🧽 Kitchen Helper';
  }
  function curLevel() { return Math.max(1, Math.min(C.MAX_TIER, Math.round(S.difficulty || 1))); }
  function statBlock(lvl) {
    return '🍕 Pizzas served: <b>' + S.served + '</b><br>' +
           '📖 Top level reached: <b>Level ' + lvl + '</b><br>' +
           '💰 Best till today: <b>$' + LS.high + '</b><br>' +
           '✨ Aura: <b>' + S.aura + '</b>';
  }
  function gameOver() {
    stopTipTimer(); stopPatienceTimer();
    var lvl = curLevel();
    el('over-rank').textContent = 'You made it to ' + chefRank(lvl) + '!';
    el('over-stats').innerHTML = statBlock(lvl);
    show('over-overlay');
  }
  // Beat the game: 5 tipped pizzas at the top level. Sits over the result card;
  // dismissing it carries on (you keep your top level and can keep playing).
  function showVictory() {
    Snd.legend();
    el('victory-stats').innerHTML = statBlock(curLevel());
    show('victory-overlay');
  }

  // ---- effects: a tiny WebAudio "sound kit" ----
  // Sounds are SYNTHESIZED, not loaded from files: that keeps the game offline-safe
  // and lets it run from file:// (where fetch()/decodeAudioData of an audio asset is
  // CORS-blocked) with zero load latency. Everything routes through ensureCtx(),
  // which returns null when muted, so the mute toggle silences the whole kit. The
  // AudioContext is created lazily inside a user gesture (Start / a tap), per the
  // browser autoplay policy.
  var actx = null;
  function ensureCtx() {
    if (LS.muted) return null;
    try {
      if (!actx) actx = new (window.AudioContext || window.webkitAudioContext)();
      if (actx.state === 'suspended') actx.resume();
    } catch (e) { actx = null; }
    return actx;
  }
  // one shaped oscillator note, optionally gliding from -> to in frequency.
  function tone(o) {
    if (!actx) return;
    var t = actx.currentTime + (o.at || 0), dur = o.dur, vol = o.vol == null ? 0.2 : o.vol;
    var osc = actx.createOscillator(), g = actx.createGain();
    osc.type = o.type || 'triangle';
    osc.frequency.setValueAtTime(o.from || o.freq, t);
    if (o.to) osc.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g); g.connect(actx.destination);
    osc.start(t); osc.stop(t + dur + 0.03);
  }
  // a short filtered noise burst (whoosh / thunk).
  function noise(o) {
    if (!actx) return;
    var t = actx.currentTime + (o.at || 0), n = Math.floor(actx.sampleRate * o.dur);
    var buf = actx.createBuffer(1, n, actx.sampleRate), d = buf.getChannelData(0);
    for (var i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    var src = actx.createBufferSource(); src.buffer = buf;
    var f = actx.createBiquadFilter(); f.type = 'bandpass';
    f.frequency.setValueAtTime(o.from || 1200, t);
    if (o.to) f.frequency.exponentialRampToValueAtTime(o.to, t + o.dur);
    var g = actx.createGain(); g.gain.value = o.vol == null ? 0.12 : o.vol;
    src.connect(f); f.connect(g); g.connect(actx.destination);
    src.start(t); src.stop(t + o.dur);
  }
  function run(fn) { return function () { if (ensureCtx()) fn(); }; }
  // a topping landing climbs in pitch with each placement in a quick run, for a
  // satisfying "combo" feel, then resets after a short pause.
  var placeStep = 0, placeAt = 0;
  var Snd = {
    pick: run(function () { tone({ freq: 660, dur: 0.06, type: 'square', vol: 0.11 }); }),
    place: run(function () {
      var now = Date.now(); if (now - placeAt > 1100) placeStep = 0; placeAt = now;
      var f = 523 * Math.pow(1.05946, Math.min(placeStep++, 12)); // semitone climb
      tone({ from: f, to: f * 1.5, dur: 0.09, type: 'triangle', vol: 0.16 });
    }),
    erase: run(function () { tone({ from: 360, to: 180, dur: 0.1, type: 'sawtooth', vol: 0.12 }); }),
    box: run(function () { noise({ from: 1700, to: 280, dur: 0.22, vol: 0.14 }); tone({ from: 200, to: 110, dur: 0.22, type: 'sine', vol: 0.18, at: 0.04 }); }),
    coin: run(function () { tone({ freq: 988, dur: 0.1, type: 'square', vol: 0.15 }); tone({ freq: 1319, dur: 0.16, type: 'square', vol: 0.15, at: 0.09 }); }),
    success: run(function () { [523, 659, 784, 1047].forEach(function (f, i) { tone({ freq: f, dur: 0.16, type: 'triangle', vol: 0.17, at: i * 0.085 }); }); }),
    perfect: run(function () { [523, 659, 784, 1047, 1319].forEach(function (f, i) { tone({ freq: f, dur: 0.17, type: 'triangle', vol: 0.18, at: i * 0.08 }); }); tone({ freq: 2093, dur: 0.25, type: 'sine', vol: 0.09, at: 0.42 }); }),
    meh: run(function () { tone({ freq: 440, dur: 0.12, type: 'triangle', vol: 0.14 }); tone({ freq: 415, dur: 0.16, type: 'triangle', vol: 0.14, at: 0.16 }); }),
    fail: run(function () { tone({ from: 392, to: 196, dur: 0.2, type: 'sawtooth', vol: 0.15 }); tone({ from: 370, to: 165, dur: 0.26, type: 'sawtooth', vol: 0.13, at: 0.18 }); }),
    fanfare: run(function () { [392, 523, 659].forEach(function (f, i) { tone({ freq: f, dur: 0.13, type: 'square', vol: 0.15, at: i * 0.1 }); }); tone({ freq: 784, dur: 0.22, type: 'square', vol: 0.15, at: 0.3 }); }),
    legend: run(function () { [523, 659, 784, 1047, 784, 1047, 1319].forEach(function (f, i) { tone({ freq: f, dur: 0.2, type: 'triangle', vol: 0.18, at: i * 0.12 }); }); }),
    sixseven: run(function () { tone({ freq: 587, dur: 0.18, type: 'square', vol: 0.16 }); tone({ freq: 784, dur: 0.26, type: 'square', vol: 0.16, at: 0.2 }); }),
    // the speed-tip window expiring: a soft, deflating "aww" (not the harsh fail buzz).
    tipLost: run(function () { tone({ from: 660, to: 330, dur: 0.3, type: 'sine', vol: 0.13 }); tone({ from: 440, to: 210, dur: 0.34, type: 'triangle', vol: 0.1, at: 0.07 }); })
  };

  function kaching(amount) {
    Snd.coin();
    var moneyEl = el('money').getBoundingClientRect();
    var d = document.createElement('div'); d.className = 'money-fly'; d.textContent = '+$' + amount;
    d.style.left = (moneyEl.left + moneyEl.width / 2) + 'px'; d.style.top = (moneyEl.bottom + 6) + 'px';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1150);
  }
  function banner67() { Snd.sixseven(); var d = document.createElement('div'); d.className = 'banner67'; d.textContent = 'SIX… SEVEN!'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1400); }

  // =========================================================================
  // wiring
  // =========================================================================
  // Show which level the saved progress will resume at, on the welcome page.
  function showResumeLevel() {
    var lvl = Math.max(1, Math.min(C.MAX_TIER, Math.round(LS.difficulty)));
    var node = el('resume-level'); if (node) node.textContent = 'Level ' + lvl;
  }
  // Hand the shop to a new player: clear the saved level and the "already taught"
  // progress so ingredients and recipes are introduced again from scratch. The
  // all-time high score (the shop's record) is left alone.
  function resetPlayer() {
    if (!window.confirm('Start fresh for a new player? This resets the level back to 1.')) return;
    LS.difficulty = 1;
    LS.seen = [];
    LS.taught = [];
    if (S) S.difficulty = 1;
    showResumeLevel();
  }

  function init() {
    refreshHud();
    showResumeLevel();
    el('start-btn').onclick = function () { ensureCtx(); startGame(); };
    el('reset-btn').onclick = resetPlayer;
    el('restart-btn').onclick = function () { hide('over-overlay'); startGame(); };
    el('next-btn').onclick = nextCustomer;
    el('box-btn').onclick = boxIt;
    el('clear-btn').onclick = function () { if (S) { S.layout = C.emptyLayout(); renderPizza(); } };
    el('eraser-btn').onclick = function () {
      if (!S) return;
      if (S.brush && S.brush.kind === 'eraser') { S.brush = null; el('eraser-btn').classList.remove('on'); }
      else { S.brush = { kind: 'eraser' }; el('eraser-btn').classList.add('on'); }
      reflectBrush();
    };
    el('meme-toggle').onclick = function () { LS.meme = !LS.meme; refreshHud(); };
    el('mute-toggle').onclick = function () { LS.muted = !LS.muted; if (!LS.muted) { ensureCtx(); Snd.pick(); } refreshHud(); };
    el('victory-btn').onclick = function () { hide('victory-overlay'); hide('result-overlay'); nextCustomer(); };
    preloadArt();

    if (location.hash.indexOf('selftest') !== -1) runSelfTest();
    if (location.hash.indexOf('nointro') !== -1) markSeen(C.UNLOCK_ORDER);
    if (location.hash.indexOf('play') !== -1) startGame();
    if (location.hash.indexOf('demo') !== -1) demoFill();
    if (location.hash.indexOf('victory') !== -1) { markSeen(C.UNLOCK_ORDER); startGame(); showVictory(); }
    else if (location.hash.indexOf('win') !== -1) devWin();
  }
  function demoFill() {
    markSeen(C.UNLOCK_ORDER); startGame();
    S.layout = C.emptyLayout();
    C.paint(S.layout, C.REGION.whole, { base: 'tomato' });
    C.paint(S.layout, C.REGION.right, { addTopping: 'pepperoni' });
    C.paint(S.layout, C.REGION.left, { addTopping: 'mushroom' });
    C.paint(S.layout, C.REGION['top-left'], { addTopping: 'ham' });
    renderPizza();
  }
  function devWin() {
    markSeen(C.UNLOCK_ORDER); startGame();
    S.layout = C.cloneLayout(S.order.acceptable[0]).map(function (s) { return s.wildcard ? C.makeSlice('tomato', ['olive']) : s; });
    renderPizza(); boxIt();
  }

  function runSelfTest() {
    var pass = 0, fail = 0; function t(c) { c ? pass++ : fail++; }
    t(C.REGION.whole.length === 8);
    var spec = C.emptyLayout(); C.paint(spec, C.REGION.whole, { base: 'tomato', addTopping: 'pepperoni' });
    t(C.grade(C.cloneLayout(spec), C.orbit(spec, [C.rot(0), C.reflectV()])).accuracy === 1);
    var o = C.generateOrder({ ordersServed: 16, unlocked: C.UNLOCK_ORDER });
    t(o.acceptable.length >= 1 && o.text.length > 0);
    var b = document.createElement('div');
    b.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999;padding:8px;text-align:center;font-weight:800;color:#fff;background:' + (fail ? '#c0392b' : '#2aa877');
    b.textContent = 'SELF-TEST ' + (fail ? 'FAILED ' + fail : 'PASSED ' + pass + ' checks');
    document.body.appendChild(b);
  }

  document.addEventListener('DOMContentLoaded', init);
})();
