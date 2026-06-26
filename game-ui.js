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
    set difficulty(v) { localStorage.setItem('pizzashop.difficulty', v); },
    // The live run (money + orders served) is persisted too, so closing or
    // reloading mid-run resumes exactly where the child left off, not just at the
    // saved level. Cleared (back to a fresh $20 run) only on game-over or reset.
    get money() { var v = parseFloat(localStorage.getItem('pizzashop.money')); return (isFinite(v) && v >= 0) ? v : 20; },
    set money(v) { localStorage.setItem('pizzashop.money', v); },
    get served() { return +(localStorage.getItem('pizzashop.served') || 0); },
    set served(v) { localStorage.setItem('pizzashop.served', v); }
  };

  var S = null;
  function newRun() {
    S = { money: LS.money, served: LS.served, aura: 0, order: null, layout: C.emptyLayout(),
      brush: null, tipDeadline: 0, tipWindowMs: 0, tipTimer: null, lastKey: null,
      patienceDeadline: 0, patienceWindowMs: 0, patienceTimer: null,
      featureNext: null, difficulty: LS.difficulty, maxStreak: 0, won: false, awaitingStart: false };
  }
  // Persist the whole run. Called at every order outcome so progress is never
  // more than one order stale. (Difficulty is also written in adjustDifficulty.)
  function saveProgress() { if (!S) return; LS.money = S.money; LS.served = S.served; LS.difficulty = S.difficulty; }
  // End the run's money/served (the level is kept) so the next game starts fresh.
  function clearRun() { LS.money = 20; LS.served = 0; }

  // Topping display names for the order-text highlight pass in Glossary.linkify.
  // NOT base words ("cheese base" is a base instruction, not a topping to skim
  // for) and NOT recipe names (those are passed separately to be protected, so a
  // glossary term can't link a sub-word like "meat" inside "Meat Feast").
  var INGREDIENT_NAMES = null, RECIPE_NAMES = null;
  function ingredientNames() {
    if (!INGREDIENT_NAMES) INGREDIENT_NAMES = Object.keys(C.TOPPING).map(function (id) { return C.TOPPING[id].name; });
    return INGREDIENT_NAMES;
  }
  function recipeNames() {
    if (!RECIPE_NAMES) RECIPE_NAMES = Object.keys(C.RECIPE);
    return RECIPE_NAMES;
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

  // Warm the browser cache for every customer face and every shop scene so they
  // appear instantly when first shown instead of popping in. References are held
  // in WARM_CACHE so the in-flight Image objects are not garbage-collected before
  // they finish loading. Deferred to idle time so it never delays the first paint.
  var WARM_CACHE = [];
  function preloadAll() {
    var urls = [];
    C.CAST.forEach(function (c) { urls.push('assets/customers/' + c.id + '.png'); });
    urls.push('assets/customers/kid.png');
    urls.push('assets/scene/shop.png');
    for (var t = 1; t <= C.MAX_TIER; t++) urls.push('assets/scene/shop-' + t + '.png');
    var i = 0;
    function next() {
      if (i >= urls.length) return;
      var im = new Image();
      im.onload = im.onerror = next; // chain so we never fire more than a few at once
      im.src = urls[i++];
      WARM_CACHE.push(im);
    }
    // a few parallel chains: fast warm-up without saturating the connection pool
    for (var k = 0; k < 4; k++) next();
  }
  function deferPreloadAll() {
    if (typeof requestIdleCallback === 'function') requestIdleCallback(preloadAll, { timeout: 2000 });
    else setTimeout(preloadAll, 600);
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

  function isMulti() { return !!(S && S.order && S.order.pizzas === 2); }
  function boardLayouts() { return isMulti() ? [S.layout, S.layout1] : [S.layout]; }
  function renderPizza() {
    if (isMulti()) { renderBoards(); return; }
    showSingleView();
    drawPizza(el('pizza'), S.layout, 'main', 470);
    attachPizzaHandlers();
  }
  // ---- two-board (multi-pizza) view: built once, reused, shown only for multi ----
  var multiBuilt = false;
  function buildMultiDom() {
    if (multiBuilt) return;
    multiBuilt = true;
    var wrap = document.createElement('div'); wrap.id = 'multi-wrap';
    wrap.innerHTML =
      '<div class="boards">' +
        '<figure class="board"><svg id="pizzaA"></svg><figcaption>Pizza 1</figcaption></figure>' +
        '<figure class="board"><svg id="pizzaB"></svg><figcaption>Pizza 2</figcaption></figure>' +
      '</div>' +
      '<div id="fraction-strip"></div>';
    var pw = el('pizza-wrap'); pw.parentNode.insertBefore(wrap, pw.nextSibling);
    // read S.layout/S.layout1 LIVE at tap time (they are reassigned each order)
    el('pizzaA').addEventListener('pointerdown', function (e) { onBoardTap(e, S.layout, el('pizzaA')); });
    el('pizzaB').addEventListener('pointerdown', function (e) { onBoardTap(e, S.layout1, el('pizzaB')); });
  }
  function showSingleView() { el('pizza-wrap').style.display = ''; if (multiBuilt) el('multi-wrap').style.display = 'none'; }
  function showMultiView() { buildMultiDom(); el('pizza-wrap').style.display = 'none'; el('multi-wrap').style.display = 'block'; }
  function renderBoards() {
    showMultiView();
    drawPizza(el('pizzaA'), S.layout, 'bA', 300);
    drawPizza(el('pizzaB'), S.layout1, 'bB', 300);
    if (S.order.mode === 'B') renderFractionStrip(); else el('fraction-strip').style.display = 'none';
  }
  // Mode B live fraction strip: 16 cells (one per slice) coloured by the kind each
  // slice currently matches, plus a legend of have/need and the reduced fraction.
  var KIND_COLORS = ['#cf3a22', '#f1c40f', '#9c5a23', '#2a8f5f', '#7d5fff', '#e67e22'];
  function classifySlice(slice, kinds) {
    for (var i = 0; i < kinds.length; i++) if (C.sliceScore(slice, kinds[i].spec) === 1) return i;
    return -1;
  }
  function renderFractionStrip() {
    var strip = el('fraction-strip'); strip.style.display = 'block';
    var kinds = S.order.pool.kinds, slices = S.layout.concat(S.layout1);
    var have = kinds.map(function () { return 0; });
    var cells = slices.map(function (s) { var k = classifySlice(s, kinds); if (k >= 0) have[k]++; return k; });
    var bar = '<div class="fstrip-bar">' + cells.map(function (k) {
      return '<span class="fcell"' + (k >= 0 ? ' style="background:' + KIND_COLORS[k % KIND_COLORS.length] + '"' : '') + '></span>';
    }).join('') + '</div>';
    var legend = '<div class="fstrip-legend">' + kinds.map(function (k, i) {
      var fr = C.reduceFraction(k.count, 16);
      return '<span class="fkey"><i style="background:' + KIND_COLORS[i % KIND_COLORS.length] + '"></i>' +
        k.label + ' <b>' + have[i] + '/' + k.count + '</b> <small>(' + fr[0] + '/' + fr[1] + ')</small></span>';
    }).join('') + '</div>';
    strip.innerHTML = bar + legend;
  }

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

  // Apply the current brush to one slice. Returns true if anything changed (so the
  // caller re-renders). Shared by the single pizza and each multi-pizza board.
  function applyBrush(slice) {
    if (!S.brush) { flashHint('Pick a topping or base from the shelf first!'); return false; }
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
      if (slice.base === 'plain' && Math.round(S.difficulty || 1) <= 5) { flashHint('Put a base on this slice first! 🍅'); return false; }
      var ti = slice.toppings.indexOf(S.brush.id);
      if (ti === -1) { slice.toppings = slice.toppings.concat([S.brush.id]).sort(); Snd.place(); }
      else { slice.toppings.splice(ti, 1); Snd.erase(); } // tap again to remove
    }
    return true;
  }
  function onPizzaTap(e) {
    if (!S || S.awaitingStart) return; // building is gated until Ready
    var w = wedgeAt(e.clientX, e.clientY);
    if (w < 0) return;
    if (applyBrush(S.layout[w])) renderPizza();
  }
  // Tap on a specific multi-pizza board (its own SVG + layout).
  function onBoardTap(e, layout, svg) {
    if (!S || S.awaitingStart) return;
    var w = wedgeAt(e.clientX, e.clientY, svg);
    if (w < 0) return;
    if (applyBrush(layout[w])) renderPizza();
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
    S.order = C.generateOrder({ ordersServed: S.served, unlocked: unlocked, difficulty: S.difficulty, avoidKey: S.lastKey, require: require, taught: LS.taught, multiPizza: true });
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
    S.layout1 = C.emptyLayout(); // second board (used only for multi-pizza orders)
    S.brush = null;
    renderPizza(); reflectBrush();

    var cust = C.CAST[Math.floor(Math.random() * C.CAST.length)];
    el('cust-name').textContent = cust.name;
    setAvatar(cust);
    S.order._cust = cust;

    el('bubble').innerHTML = window.Glossary.linkify(S.order.text, ingredientNames(), recipeNames());
    el('tier-pill').style.display = 'inline-block';
    el('tier-pill').textContent = 'Level ' + S.order.tier;
    setScene(S.order.tier);

    // Hold the timers: show the order on a playbill (customer on the shop scene
    // with the order text) gated by a Ready? button, so a young player reads the
    // order before any clock runs. The timers start only on Ready (readyToStart).
    showOrderIntro(cust);
  }
  // The order-intro playbill. Built once, reused per order. On Ready it folds up
  // toward the customer panel (CSS transition) and the timers begin.
  function showOrderIntro(cust) {
    S.awaitingStart = true;
    var ov = el('order-intro');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'order-intro'; ov.className = 'overlay order-intro';
      ov.innerHTML =
        '<div class="oi-card">' +
          '<img class="oi-face" id="oi-face" alt="">' +
          '<div class="oi-name" id="oi-name"></div>' +
          '<div class="oi-bubble" id="oi-bubble"></div>' +
          '<button class="big box" id="oi-ready">Ready? ▶</button>' +
        '</div>';
      document.body.appendChild(ov);
      el('oi-ready').onclick = readyToStart; // child persists across reuse
    }
    var t = Math.max(1, Math.min(C.MAX_TIER, Math.round(S.order.tier || 1)));
    ov.style.backgroundImage = 'linear-gradient(rgba(20,10,0,.4), rgba(20,10,0,.55)), ' +
      'url(assets/scene/shop-' + t + '.png), url(assets/scene/shop.png)';
    var face = el('oi-face');
    face.style.visibility = 'visible';
    face.onerror = function () { face.style.visibility = 'hidden'; };
    face.src = 'assets/customers/' + cust.id + '.png';
    el('oi-name').textContent = cust.name;
    el('oi-bubble').innerHTML = window.Glossary.linkify(S.order.text, ingredientNames(), recipeNames());
    ov.classList.remove('folding');
    show('order-intro');
  }
  function readyToStart() {
    if (!S || !S.awaitingStart) return;
    S.awaitingStart = false;
    var ov = el('order-intro');
    if (ov) {
      ov.classList.add('folding'); // shrink + rise toward the customer panel
      setTimeout(function () { hide('order-intro'); ov.classList.remove('folding'); }, 480);
    }
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
  // Slices that represent the work in an order: 16 for a two-board order, 8 else.
  function orderWorkSlices(order) { return order.pizzas === 2 ? C.multiSlices(order) : order.acceptable[0]; }
  function countTaps(layout) {
    var taps = 0;
    for (var i = 0; i < layout.length; i++) {
      var s = layout[i];
      if (s.wildcard) { taps += 2; continue; }
      if (s.base !== 'plain') taps += 1;
      // category-count slices ("any 3 meats") carry a count (or a min/max range),
      // not a toppings array. Use the lower bound as the work estimate.
      if (s.catCount) { taps += (s.count != null ? s.count : (s.min != null ? s.min : 1)); continue; }
      taps += s.toppings.length;
    }
    return taps;
  }
  function startTipTimer(order) {
    var taps = countTaps(orderWorkSlices(order));
    // Scales with the work, but the FLOOR is a generous 60s because a young
    // child spends most of the window READING the order, not tapping, and the
    // tip also gates levelling up (see adjustDifficulty) so it must be reachable.
    // window = clamp(14s + 2.4s/tap, 60s .. 90s). For a single 8-slice pizza the
    // computed value is below 60s, so almost every single-pizza order gets the
    // full 60s; only big multi-pizza (16-slice) orders scale above the floor.
    S.tipWindowMs = Math.min(90000, Math.max(60000, Math.round((14 + taps * 2.4) * 1000)));
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
    for (var i = 0; i < layout.length; i++) {
      var s = layout[i];
      var key = s.wildcard ? 'wild' : (s.catCount ? ('cat:' + s.cat + (s.count != null ? s.count : (s.min + '-' + s.max)) + '|' + s.base) : (s.base + '|' + s.toppings.join(',')));
      if (!seen[key]) { seen[key] = 1; regions++; }
    }
    return regions;
  }
  function startPatienceTimer(order) {
    buildPatienceBar();
    var taps = countTaps(orderWorkSlices(order));
    var regions = countRegions(orderWorkSlices(order));
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
  // Freeze both countdowns (e.g. while a glossary is open) and resume exactly where
  // they left off, so looking up a word never costs the tip or the customer's
  // patience. No-ops if no order is running or a timer already finished.
  function pauseTimers() {
    if (!S) return;
    if (S.tipTimer) { S.tipPausedLeft = S.tipDeadline - Date.now(); clearInterval(S.tipTimer); S.tipTimer = null; }
    if (S.patienceTimer) { S.patPausedLeft = S.patienceDeadline - Date.now(); clearInterval(S.patienceTimer); S.patienceTimer = null; }
  }
  function resumeTimers() {
    if (!S) return;
    if (S.tipPausedLeft != null) { S.tipDeadline = Date.now() + S.tipPausedLeft; S.tipPausedLeft = null; S.tipTimer = setInterval(tickTip, 100); tickTip(); }
    if (S.patPausedLeft != null) { S.patienceDeadline = Date.now() + S.patPausedLeft; S.patPausedLeft = null; S.patienceTimer = setInterval(tickPatience, 100); tickPatience(); }
  }

  // ---- box it ----
  // Simple, explicit economy a kid can hold in their head: a pizza costs $3 of
  // dough to make and a correct one sells for $5 (a $2 profit), plus a $1 speed tip.
  var MAKE_COST = 3, SALE_PRICE = 5;
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
    if (!S || !S.order || S.awaitingStart) return; // can't box before Ready
    Snd.box();
    var fast = (Date.now() <= S.tipDeadline);
    stopTipTimer(); stopPatienceTimer();
    var res = isMulti() ? C.gradeMulti(S.order, boardLayouts()) : C.grade(S.layout, S.order.acceptable);
    var acc = res.accuracy, tier = S.order.tier;
    // Below 0.8 accuracy the customer refuses the pizza: no pay, player still eats
    // the $3 make-cost.
    var refused = acc < 0.8;
    var reward = refused ? 0 : SALE_PRICE;
    var tip = (!refused && fast) ? 1 : 0; // refused already requires acc>=0.8
    S.money += -MAKE_COST + reward + tip;
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
    saveProgress();
    if (reward + tip > 0) kaching(reward + tip);
    if (S.order._cust && S.order._cust.gag === 'sixseven') banner67();
    showResult(acc, reward, tip, refused, res);
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
    saveProgress();
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
    el('result-concept').style.display = 'none';
    el('next-btn').textContent = 'Next customer ▶';
    show('result-overlay');
    autoAdvance(3500);
  }

  function showResult(acc, reward, tip, refused, res) {
    var closest = res.closest;
    var band = C.reactionBand(acc);
    // celebratory / sympathetic sting, slightly after the coin so they don't muddy.
    setTimeout(refused ? Snd.fail : (acc >= 1 ? Snd.perfect : (band === 'great' ? Snd.success : Snd.meh)), 180);
    if (!refused && acc >= 1) setTimeout(Snd.cheer, 260); // a perfect pizza gets a cheer
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

    // Concept-first feedback. On a perfect pizza we just celebrate; otherwise we
    // explain the IDEA the order was teaching (with tappable words) plus a gentle
    // "you got X of 8 right", and show the two pizzas. No per-slice text diff.
    var compare = el('result-compare'), ul = el('result-mistakes'), concept = el('result-concept');
    compare.innerHTML = ''; ul.innerHTML = ''; ul.style.display = 'none';
    el('next-btn').textContent = 'Next customer ▶';
    if (isMulti()) {
      showMultiFeedback(acc, res, concept, compare);
      show('result-overlay');
      if (acc >= 1) autoAdvance(3500);
      return;
    }
    var mistakes = C.describeMistakes(S.layout, closest);
    if (mistakes.length === 0) {
      concept.style.display = 'none'; compare.style.display = 'none';
      show('result-overlay');
      autoAdvance(3500); // quick win: auto-advance unless they click first
    } else {
      var right = 8 - mistakes.length;
      concept.innerHTML = window.Glossary.conceptExplanation(S.order) +
        ' <span class="hint-line">You got <b>' + right + ' of 8</b> slices right.</span>';
      concept.style.display = 'block';
      compare.style.display = 'flex';
      compare.appendChild(miniFig('What you made', S.layout));
      compare.appendChild(miniFig('What they wanted', closest));
      show('result-overlay');
    }
  }
  var autoTimer = null;
  function autoAdvance(ms) { if (autoTimer) clearTimeout(autoTimer); autoTimer = setTimeout(function () { if (el('result-overlay').classList.contains('show')) nextCustomer(); }, ms); }
  function describeSlice(baseName, toppings) {
    var t = toppings.length ? toppings.join(' + ') : 'no toppings';
    return baseName.toLowerCase() + ' with ' + t;
  }
  var miniSeq = 0;
  function miniFig(label, layout) {
    var fig = document.createElement('figure');
    var svg = document.createElementNS(SVGNS, 'svg');
    drawPizza(svg, layout, 'mini' + (miniSeq++), 150);
    fig.appendChild(svg);
    var cap = document.createElement('figcaption'); cap.textContent = label; fig.appendChild(cap);
    return fig;
  }
  // Multi-pizza result: both built boards, plus the count/fraction reveal (Mode B)
  // or the two target pizzas (Mode A), and "you got X of 16 right".
  function exactMatches(layout, spec) {
    var n = 0; for (var i = 0; i < layout.length; i++) if (C.sliceScore(layout[i], spec[i]) === 1) n++; return n;
  }
  function showMultiFeedback(acc, res, concept, compare) {
    var right, explain;
    if (S.order.mode === 'B') {
      var kinds = S.order.pool.kinds, slices = S.layout.concat(S.layout1);
      var have = kinds.map(function () { return 0; });
      slices.forEach(function (s) { var k = classifySlice(s, kinds); if (k >= 0) have[k]++; });
      right = have.reduce(function (a, b) { return a + b; }, 0); // exact-match count, matches the legend
      explain = 'Across all 16 slices: ' + kinds.map(function (k, i) {
        var fr = C.reduceFraction(k.count, 16);
        return '<b>' + k.label + '</b> — you made ' + have[i] + ', needed ' + k.count + ' (' + fr[0] + '/' + fr[1] + ')';
      }).join('; ') + '.';
    } else {
      right = res.closest ? exactMatches(S.layout, res.closest[0]) + exactMatches(S.layout1, res.closest[1]) : Math.round(acc * 16);
      explain = 'Two whole pizzas, one of each.';
    }
    concept.innerHTML = explain + ' <span class="hint-line">You got <b>' + right + ' of 16</b> slices right.</span>';
    concept.style.display = 'block';
    compare.style.display = 'flex'; compare.style.flexWrap = 'wrap';
    compare.appendChild(miniFig('Your Pizza 1', S.layout));
    compare.appendChild(miniFig('Your Pizza 2', S.layout1));
    if (S.order.mode === 'A' && res.closest) {
      compare.appendChild(miniFig('Wanted', res.closest[0]));
      compare.appendChild(miniFig('Wanted', res.closest[1]));
    }
  }

  function nextCustomer() {
    if (autoTimer) { clearTimeout(autoTimer); autoTimer = null; }
    hide('result-overlay');
    S.served += 1; refreshHud();
    if (S.money < 3) { gameOver(); return; }
    saveProgress();
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
    clearRun(); // the run is over: next game starts at a fresh $20 (level is kept)
    var lvl = curLevel();
    el('over-rank').textContent = 'You made it to ' + chefRank(lvl) + '!';
    el('over-stats').innerHTML = statBlock(lvl);
    show('over-overlay');
  }
  // Beat the game: 5 tipped pizzas at the top level. Sits over the result card;
  // dismissing it carries on (you keep your top level and can keep playing).
  function showVictory() {
    Snd.legend(); Snd.cheer();
    el('victory-stats').innerHTML = statBlock(curLevel());
    show('victory-overlay');
  }

  // ---- effects: recorded CC0 sound kit ----
  // All sounds are short mp3 samples in assets/sfx/ (Kenney, public domain / CC0;
  // see assets/sfx/CREDITS.txt). mp3 is used because iOS Safari (the tablet target)
  // cannot play .ogg. Played via HTMLAudioElement, which works from file:// (unlike
  // fetch()/decodeAudioData, CORS-blocked locally). cloneNode lets the same sound
  // overlap on rapid taps. The mute toggle silences everything; a missing file just
  // plays nothing, so the game stays fully playable without the assets.
  var SFX_VOL = {
    pick: 0.45, place: 0.6, erase: 0.5, box: 0.7, coin: 0.85, meh: 0.7,
    success: 0.8, perfect: 0.9, fail: 0.7, fanfare: 0.8, legend: 0.9,
    cheer: 0.95, sixseven: 0.85, tipLost: 0.7
  };
  var clipBase = {};
  function preloadClips() {
    Object.keys(SFX_VOL).forEach(function (id) {
      var a = new Audio('assets/sfx/' + id + '.mp3');
      a.preload = 'auto'; a.volume = SFX_VOL[id];
      clipBase[id] = a;
    });
  }
  // iOS unlocks <audio> only inside a user gesture: prime every clip once on the
  // first Start/tap so later programmatic plays are allowed.
  var audioUnlocked = false;
  function unlockAudio() {
    if (audioUnlocked) return; audioUnlocked = true;
    Object.keys(clipBase).forEach(function (id) {
      var a = clipBase[id];
      try {
        a.muted = true; var p = a.play();
        if (p && p.then) p.then(function () { a.pause(); a.currentTime = 0; a.muted = false; }).catch(function () { a.muted = false; });
        else { a.pause(); a.muted = false; }
      } catch (e) { a.muted = false; }
    });
  }
  function playSfx(id) {
    if (LS.muted) return;
    var base = clipBase[id]; if (!base) return;
    try {
      var node = base.cloneNode();      // fresh node so rapid sounds can overlap
      node.volume = base.volume;
      var p = node.play(); if (p && p.catch) p.catch(function () { });
    } catch (e) { /* autoplay blocked until first gesture; ignore */ }
  }
  var Snd = {};
  Object.keys(SFX_VOL).forEach(function (id) { Snd[id] = function () { playSfx(id); }; });

  function kaching(amount) {
    Snd.coin();
    var moneyEl = el('money').getBoundingClientRect();
    var d = document.createElement('div'); d.className = 'money-fly'; d.textContent = '+$' + amount;
    d.style.left = (moneyEl.left + moneyEl.width / 2) + 'px'; d.style.top = (moneyEl.bottom + 6) + 'px';
    document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1150);
  }
  function banner67() { Snd.sixseven(); var d = document.createElement('div'); d.className = 'banner67'; d.textContent = 'SIX… SEVEN!'; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1400); }

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
    clearRun(); // fresh money + orders-served for the new player
    if (S) S.difficulty = 1;
    showResumeLevel();
  }

  function init() {
    refreshHud();
    showResumeLevel();
    el('start-btn').onclick = function () { unlockAudio(); startGame(); };
    document.addEventListener('pointerdown', unlockAudio); // unlock audio on first touch anywhere
    window.Glossary.init({ pause: pauseTimers, resume: resumeTimers });
    el('gloss-btn').onclick = function () { window.Glossary.openPage(); };
    el('welcome-gloss-btn').onclick = function () { window.Glossary.openPage(); };
    el('reset-btn').onclick = resetPlayer;
    el('restart-btn').onclick = function () { hide('over-overlay'); startGame(); };
    el('next-btn').onclick = nextCustomer;
    el('box-btn').onclick = boxIt;
    el('clear-btn').onclick = function () { if (S) { S.layout = C.emptyLayout(); S.layout1 = C.emptyLayout(); renderPizza(); } };
    el('eraser-btn').onclick = function () {
      if (!S) return;
      if (S.brush && S.brush.kind === 'eraser') { S.brush = null; el('eraser-btn').classList.remove('on'); }
      else { S.brush = { kind: 'eraser' }; el('eraser-btn').classList.add('on'); }
      reflectBrush();
    };
    el('meme-toggle').onclick = function () { LS.meme = !LS.meme; refreshHud(); };
    el('mute-toggle').onclick = function () { LS.muted = !LS.muted; if (!LS.muted) { unlockAudio(); Snd.pick(); } refreshHud(); };
    el('victory-btn').onclick = function () { hide('victory-overlay'); hide('result-overlay'); nextCustomer(); };
    preloadArt();
    preloadClips();
    deferPreloadAll();

    if (location.hash.indexOf('selftest') !== -1) runSelfTest();
    if (location.hash.indexOf('glossary') !== -1) window.Glossary.openPage();
    if (location.hash.indexOf('nointro') !== -1) markSeen(C.UNLOCK_ORDER);
    if (location.hash.indexOf('play') !== -1) startGame();
    if (location.hash.indexOf('demo') !== -1) demoFill();
    if (location.hash.indexOf('victory') !== -1) { markSeen(C.UNLOCK_ORDER); startGame(); showVictory(); }
    else if (location.hash.indexOf('win') !== -1) devWin();
    else if (location.hash.indexOf('multiboxA') !== -1) devMulti('A', true, false);
    else if (location.hash.indexOf('multiboxB') !== -1) devMulti('B', true, false);
    else if (location.hash.indexOf('multifailB') !== -1) devMulti('B', true, true);
    else if (location.hash.indexOf('multiA') !== -1) devMulti('A', false, false);
    else if (location.hash.indexOf('multiB') !== -1) devMulti('B', false, false);
    else if (location.hash.indexOf('solvebox') !== -1) devSolve(true);
    else if (location.hash.indexOf('failbox') !== -1) devFail();
    else if (location.hash.indexOf('solve') !== -1) devSolve(false);
  }
  // Force a multi-pizza order of a given mode (QA / screenshots). Builds a correct
  // solution; `fail` botches one board; `box` runs grading.
  function devMulti(mode, box, fail) {
    markSeen(C.UNLOCK_ORDER); startGame(); devReady();
    S.difficulty = mode === 'B' ? 16 : 6;
    var o = null, guard = 0;
    while (guard++ < 3000 && !o) {
      var cand = C.generateOrder({ difficulty: S.difficulty, unlocked: C.UNLOCK_ORDER, taught: [], multiPizza: true });
      if (cand && cand.pizzas === 2 && cand.mode === mode) o = cand;
    }
    if (!o) return;
    S.order = o; S.lastKey = o.key;
    S.layout = C.emptyLayout(); S.layout1 = C.emptyLayout();
    el('bubble').innerHTML = window.Glossary.linkify(o.text, ingredientNames(), recipeNames());
    el('tier-pill').style.display = 'inline-block'; el('tier-pill').textContent = 'Level ' + o.tier;
    fillSolvedBoards();
    if (fail) C.REGION.right.forEach(function (i) { S.layout1[i] = C.makeSlice(S.layout1[i].base, ['olive']); });
    renderPizza();
    if (box) boxIt();
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
  // QA / screenshot hooks: build a genuinely correct solution for the current
  // order (catCount and wildcard slices filled with valid choices), or a botched
  // one. #solve shows the solved pizza; #solvebox boxes it (success result);
  // #failbox boxes a half-wrong build (refused result + concept feedback).
  function canonicalFill(spec) {
    var meats = ['pepperoni', 'ham', 'bacon', 'sausage'], veg = ['mushroom', 'olive', 'onion', 'pepper'],
      fruit = ['pineapple', 'banana', 'raisins'], silly = ['banana', 'peas', 'broccoli', 'marshmallow'],
      fruitsilly = ['banana', 'raisins'], puresilly = ['marshmallow', 'fish-heads'],
      green = ['pepper', 'spinach', 'broccoli', 'peas'], red = ['pepperoni', 'tomato-slice', 'chilli'],
      anyList = meats.concat(veg);
    return C.cloneLayout(spec).map(function (s) {
      if (s.catCount) {
        var src = s.cat === 'meat' ? meats : (s.cat === 'veg' ? veg : (s.cat === 'fruit' ? fruit :
          (s.cat === 'fruitsilly' ? fruitsilly : (s.cat === 'puresilly' ? puresilly :
            (s.cat === 'green' ? green : (s.cat === 'red' ? red : (s.cat === 'any' ? anyList : silly)))))));
        var k = s.count != null ? s.count : (s.min != null ? s.min : 1);
        return C.makeSlice(s.base, src.slice(0, k));
      }
      if (s.wildcard) {
        var against = s.surpriseAgainst || [];
        var t = ['olive', 'banana', 'mushroom', 'ham'].filter(function (c) { return against.indexOf(c) === -1; })[0] || 'olive';
        return C.makeSlice('tomato', [t]);
      }
      return s;
    });
  }
  // Fill both boards with a correct build (multi orders).
  function fillSolvedBoards() {
    if (S.order.mode === 'B') {
      S.layout = canonicalFill(S.order.canonical16.slice(0, 8));
      S.layout1 = canonicalFill(S.order.canonical16.slice(8, 16));
    } else {
      S.layout = canonicalFill(S.order.boards[0].acceptable[0]);
      S.layout1 = canonicalFill(S.order.boards[1].acceptable[0]);
    }
  }
  function devReady() { S.awaitingStart = false; hide('order-intro'); } // skip the playbill gate
  function devSolve(box) {
    markSeen(C.UNLOCK_ORDER); startGame(); devReady();
    if (isMulti()) fillSolvedBoards(); else S.layout = canonicalFill(S.order.acceptable[0]);
    renderPizza(); if (box) boxIt();
  }
  function devFail() {
    markSeen(C.UNLOCK_ORDER); startGame(); devReady();
    if (isMulti()) {
      fillSolvedBoards();
      C.REGION.right.forEach(function (i) { S.layout1[i] = C.makeSlice(S.layout1[i].base, ['olive']); }); // botch one board's half
    } else {
      var L = canonicalFill(S.order.acceptable[0]);
      C.REGION.right.forEach(function (i) { L[i] = C.makeSlice(L[i].base, ['olive']); }); // botch one half
      S.layout = L;
    }
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
