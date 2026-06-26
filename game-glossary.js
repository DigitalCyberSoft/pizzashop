/*
 * Glossary: turns the game's spatial / number vocabulary into a little maths
 * lesson. Key words in the order and the result screen become tappable; tapping
 * one opens a modal with a mini 8-slice pizza demonstrating the idea, a plain
 * definition, and a maths line (a quarter = 2 of 8 = 1/4). A standalone page
 * lists every concept so a parent can review what is being taught.
 *
 * UMD-ish: exposes window.Glossary. No dependencies; geometry mirrors game-core's
 * REGION map and game-ui's wedge angles so the demos match the real pizza.
 */
(function () {
  var SVGNS = 'http://www.w3.org/2000/svg';
  var N = 8, CX = 50, CY = 50, R = 44;
  var ACCENT = '#e8542a', DIM = '#ead9bd', CRUST = '#f2d8a8';
  var TINT_A = '#7db8e8', TINT_B = '#88cf9a', TINT_BOTH = '#e8542a'; // intersection Venn

  // same wedge angles as the game: wedge i spans [45i, 45(i+1)] deg clockwise from 12.
  function pt(a) { var r = a * Math.PI / 180; return [CX + R * Math.sin(r), CY - R * Math.cos(r)]; }
  function wedgePath(i) {
    var p0 = pt(45 * i), p1 = pt(45 * (i + 1));
    return 'M' + CX + ',' + CY + ' L' + p0[0] + ',' + p0[1] + ' A' + R + ',' + R + ' 0 0 1 ' + p1[0] + ',' + p1[1] + ' Z';
  }
  var REG = {
    whole: [0, 1, 2, 3, 4, 5, 6, 7], right: [0, 1, 2, 3], left: [4, 5, 6, 7],
    top: [0, 1, 6, 7], bottom: [2, 3, 4, 5],
    'top-right': [0, 1], 'bottom-right': [2, 3], 'bottom-left': [4, 5], 'top-left': [6, 7]
  };

  // a mini pizza where `fills[i]` is the colour for slice i (default crust).
  function miniPizza(fills) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'gloss-pizza');
    for (var i = 0; i < N; i++) {
      var p = document.createElementNS(SVGNS, 'path');
      p.setAttribute('d', wedgePath(i));
      p.setAttribute('fill', fills[i] || CRUST);
      p.setAttribute('stroke', '#c98a3c'); p.setAttribute('stroke-width', '1.4');
      svg.appendChild(p);
    }
    return svg;
  }
  function fillSet(slices, colour, base) {
    var f = {}; for (var i = 0; i < N; i++) f[i] = base || CRUST;
    slices.forEach(function (i) { f[i] = colour; });
    return f;
  }
  function lit(slices) { return miniPizza(fillSet(slices, ACCENT)); }

  // intersection Venn: region A and region B, overlap in a third colour.
  function venn(a, b) {
    var f = {};
    for (var i = 0; i < N; i++) {
      var inA = a.indexOf(i) !== -1, inB = b.indexOf(i) !== -1;
      f[i] = (inA && inB) ? TINT_BOTH : (inA ? TINT_A : (inB ? TINT_B : CRUST));
    }
    return miniPizza(f);
  }

  // a 0..hi number line with a highlighted band and an arrow, for more/fewer than.
  function numberLine(hi, from, to) {
    var svg = document.createElementNS(SVGNS, 'svg');
    svg.setAttribute('viewBox', '0 0 200 60'); svg.setAttribute('class', 'gloss-line');
    var x = function (n) { return 14 + n * (172 / hi); };
    var band = document.createElementNS(SVGNS, 'rect');
    band.setAttribute('x', x(Math.min(from, to))); band.setAttribute('y', 18);
    band.setAttribute('width', Math.abs(x(to) - x(from))); band.setAttribute('height', 16);
    band.setAttribute('rx', 6); band.setAttribute('fill', ACCENT); band.setAttribute('opacity', '.85');
    svg.appendChild(band);
    var line = document.createElementNS(SVGNS, 'line');
    line.setAttribute('x1', x(0)); line.setAttribute('y1', 26); line.setAttribute('x2', x(hi)); line.setAttribute('y2', 26);
    line.setAttribute('stroke', '#3a2a16'); line.setAttribute('stroke-width', '2');
    svg.appendChild(line);
    for (var n = 0; n <= hi; n++) {
      var t = document.createElementNS(SVGNS, 'line');
      t.setAttribute('x1', x(n)); t.setAttribute('y1', 22); t.setAttribute('x2', x(n)); t.setAttribute('y2', 30);
      t.setAttribute('stroke', '#3a2a16'); t.setAttribute('stroke-width', '2'); svg.appendChild(t);
      var lab = document.createElementNS(SVGNS, 'text');
      lab.setAttribute('x', x(n)); lab.setAttribute('y', 48); lab.setAttribute('text-anchor', 'middle');
      lab.setAttribute('font-size', '12'); lab.setAttribute('fill', '#3a2a16'); lab.textContent = n;
      svg.appendChild(lab);
    }
    return svg;
  }

  // a row of real topping art (assets/toppings/<id>.png), for the category terms
  // (meat / veg / fruit / silly) that are about which toppings belong together.
  // Falls back to the emoji if the PNG can't load (e.g. opened outside the game).
  var ICON_EMOJI = {
    pepperoni: '🔴', ham: '🍖', bacon: '🥓', sausage: '🌭', meatball: '🧆', chicken: '🍗',
    mushroom: '🍄', pepper: '🫑', onion: '🧅', olive: '⚫', spinach: '🍃', sweetcorn: '🌽',
    pineapple: '🍍', banana: '🍌', raisins: '🍇', broccoli: '🥦', marshmallow: '⚪', 'fish-heads': '🐟'
  };
  function iconRow(ids) {
    var d = document.createElement('div'); d.className = 'gloss-icons';
    ids.forEach(function (id) {
      var img = document.createElement('img');
      img.className = 'gloss-topping'; img.alt = id; img.src = 'assets/toppings/' + id + '.png';
      img.onerror = function () { var s = document.createElement('span'); s.textContent = ICON_EMOJI[id] || '🍕'; img.replaceWith(s); };
      d.appendChild(img);
    });
    return d;
  }
  // three colour swatches for the three bases, each labelled.
  var BASE_TINT = { tomato: '#cf3a22', cheese: '#f1c40f', bbq: '#9c5a23' };
  function baseSwatches() {
    var d = document.createElement('div'); d.className = 'gloss-swatches';
    ['tomato', 'cheese', 'bbq'].forEach(function (b) {
      var w = document.createElement('div'); w.className = 'gloss-swatch';
      var dot = document.createElement('span'); dot.className = 'gloss-dot'; dot.style.background = BASE_TINT[b];
      var lab = document.createElement('span'); lab.textContent = b;
      w.appendChild(dot); w.appendChild(lab); d.appendChild(w);
    });
    return d;
  }
  // a small whole-colour pizza, for "either / or" (this one OR that one).
  function smallPizza(colour) { var s = miniPizza(fillSet(REG.whole, colour)); s.classList.add('gloss-mini'); return s; }
  function pairDemo() {
    var d = document.createElement('div'); d.className = 'gloss-pair';
    d.appendChild(smallPizza(TINT_A));
    var o = document.createElement('span'); o.className = 'gloss-or'; o.textContent = 'OR'; d.appendChild(o);
    d.appendChild(smallPizza(TINT_B));
    return d;
  }
  // MAY: some slices on, some off, to say "your choice".
  function mayDemo() {
    var f = {}; for (var i = 0; i < N; i++) f[i] = (i % 2 === 0) ? ACCENT : DIM;
    return miniPizza(f);
  }
  // MUST NOT: a topped pizza with a red no-entry sign over it.
  function forbiddenDemo() {
    var svg = lit(REG.whole);
    var c = document.createElementNS(SVGNS, 'circle');
    c.setAttribute('cx', CX); c.setAttribute('cy', CY); c.setAttribute('r', 34);
    c.setAttribute('fill', 'none'); c.setAttribute('stroke', '#d11'); c.setAttribute('stroke-width', '7');
    var l = document.createElementNS(SVGNS, 'line');
    l.setAttribute('x1', 26); l.setAttribute('y1', 26); l.setAttribute('x2', 74); l.setAttribute('y2', 74);
    l.setAttribute('stroke', '#d11'); l.setAttribute('stroke-width', '7');
    svg.appendChild(c); svg.appendChild(l);
    return svg;
  }

  // a recipe card: the named pizza, its base swatch, and its topping icons.
  function recipeCard(name, base, icons) {
    var d = document.createElement('div'); d.className = 'gloss-recipe';
    var n = document.createElement('div'); n.className = 'gloss-recipe-name'; n.textContent = name;
    var row = iconRow([].concat(icons));
    var dot = document.createElement('span'); dot.className = 'gloss-dot'; dot.style.background = BASE_TINT[base];
    row.insertBefore(dot, row.firstChild);
    d.appendChild(n); d.appendChild(row);
    return d;
  }

  // The glossary. `syn` are phrases linkified in text (longest win, first per term).
  var TERMS = [
    { id: 'whole', label: 'Whole', syn: ['the whole pizza', 'whole'], def: 'The whole pizza means every single slice, all the way around.', math: 'all 8 slices = 1 whole (8/8)', demo: function () { return lit(REG.whole); } },
    { id: 'half', label: 'Half', syn: ['halves', 'half'], def: 'A half is one of the two equal pieces when you split the pizza down the middle.', math: '4 of 8 slices = one half = 1/2', demo: function () { return lit(REG.top); } },
    { id: 'quarter', label: 'Quarter', syn: ['quarters', 'quarter'], def: 'A quarter is one of the four equal pieces, like cutting the pizza into 4.', math: '2 of 8 slices = one quarter = 1/4', demo: function () { return lit(REG['top-right']); } },
    { id: 'slice', label: 'Slice', syn: ['slices', 'slice'], def: 'A slice is one single piece of the eight.', math: '1 of 8 slices = 1/8', demo: function () { return lit([0]); } },
    { id: 'opposite', label: 'Opposite', syn: ['directly across', 'straight across', 'across from', 'opposite', 'across'], def: 'Opposite slices are straight across the pizza from each other, as far apart as they can be.', math: 'slice + 4 = the one opposite (1 and 5, 2 and 6...)', demo: function () { return lit([0, 4]); } },
    { id: 'nextTo', label: 'Next to', syn: ['next to each other', 'right next to', 'next to', 'side by side', 'touching', 'touch'], def: 'Slices next to each other share an edge, sitting side by side.', math: 'neighbours: slice and the one beside it', demo: function () { return lit([0, 1]); } },
    { id: 'everyOther', label: 'Every other', syn: ['every other slice', 'every other', 'alternating'], def: 'Every other means skip one each time, all the way around.', math: 'take slice 1, skip 2, take 3... (the odd ones)', demo: function () { return lit([0, 2, 4, 6]); } },
    { id: 'checkerboard', label: 'Checkerboard', syn: ['checkerboard'], def: 'A checkerboard alternates two different kinds all the way around, like the squares on a chess board: every other slice is one kind, and each slice between them is the other.', math: 'A, B, A, B... two kinds taking turns around the ring', demo: function () { return miniPizza((function () { var f = {}; for (var i = 0; i < N; i++) f[i] = (i % 2 === 0) ? TINT_A : TINT_B; return f; })()); } },
    { id: 'theRest', label: 'The rest', syn: ['everything else', 'all the others', 'the rest'], def: 'The rest means all the slices left over after the ones already named.', math: '8 total − the ones used = the rest', demo: function () { return miniPizza((function () { var f = fillSet([0, 1, 2], DIM); [3, 4, 5, 6, 7].forEach(function (i) { f[i] = ACCENT; }); return f; })()); } },
    { id: 'threeInRow', label: 'Three in a row', syn: ['three slices in a row', 'three in a row', 'in a row'], def: 'Three in a row are three slices touching in a line, one after another.', math: '3 slices side by side by side', demo: function () { return lit([0, 1, 2]); } },
    { id: 'diagonal', label: 'Diagonal', syn: ['diagonally opposite', 'diagonally', 'diagonal', 'corner to corner'], def: 'Diagonal quarters are corner to corner from each other.', math: 'two quarters straight across = opposite corners', demo: function () { return lit(REG['top-right'].concat(REG['bottom-left'])); } },
    { id: 'intersection', label: 'Intersection', syn: ['intersection', 'overlap', 'where they meet', 'in both', 'meets', 'both'], def: 'The intersection is where two groups overlap — the part that belongs to BOTH. Here blue is one half, green is the other, and the orange slices are in both.', math: 'in A AND in B = the overlap', demo: function () { return venn(REG.top, REG.right); } },
    { id: 'moreThan', label: 'More than', syn: ['more than'], def: 'More than a number means you need a bigger amount than that — at least one extra.', math: 'more than 2 = 3, 4, 5 ... (greater than)', demo: function () { return numberLine(6, 3, 6); } },
    { id: 'fewerThan', label: 'Fewer than', syn: ['no more than', 'fewer than', 'less than'], def: 'Fewer than a number means you need a smaller amount than that.', math: 'fewer than 5 = 4, 3, 2, 1 (less than)', demo: function () { return numberLine(6, 1, 4); } },
    // ---- negation / spatial concepts that orders use but had no card ----
    { id: 'except', label: 'Except', syn: ['everything except', 'all but', 'except for', 'except', 'without'], def: 'Except means do the whole thing, but leave that one part out.', math: 'all 8 − the bit named = what you cover', demo: function () { return miniPizza((function () { var f = fillSet(REG.whole, ACCENT); REG['top-right'].forEach(function (i) { f[i] = DIM; }); return f; })()); } },
    { id: 'notTouch', label: 'Not touching', syn: ['must not touch', 'never touch', 'do not touch', "don't touch", 'not touching', 'kept apart', 'apart'], def: 'Not touching means leave a gap so two groups never share an edge. Here the meat (blue) and the veg (green) are kept apart.', math: 'leave at least one empty slice between them', demo: function () { return miniPizza((function () { var f = {}; for (var i = 0; i < N; i++) f[i] = CRUST; [0, 1].forEach(function (i) { f[i] = TINT_A; }); [4, 5].forEach(function (i) { f[i] = TINT_B; }); return f; })()); } },
    // ---- food categories: which toppings belong together ----
    { id: 'meat', label: 'Meat', syn: ['meats', 'meat'], def: 'Meat toppings come from animals: pepperoni, ham, bacon, sausage, meatball and chicken.', math: '6 meats in the kitchen', demo: function () { return iconRow(['pepperoni', 'ham', 'bacon', 'sausage', 'meatball', 'chicken']); } },
    { id: 'vegetable', label: 'Vegetable', syn: ['vegetables', 'veggies', 'vegetable'], def: 'Vegetables are plant toppings: mushroom, pepper, onion, olive, spinach and sweetcorn. Some silly ones, like broccoli, count too.', math: 'a vegetable is a plant you eat', demo: function () { return iconRow(['mushroom', 'pepper', 'onion', 'olive', 'spinach', 'sweetcorn']); } },
    { id: 'fruit', label: 'Fruit', syn: ['fruits', 'fruit'], def: 'Fruit toppings are sweet: pineapple, banana and raisins.', math: 'only 3 fruits on the menu', demo: function () { return iconRow(['pineapple', 'banana', 'raisins']); } },
    { id: 'silly', label: 'Silly topping', syn: ['silly toppings', 'silly topping', 'silly'], def: "Silly toppings are funny foods you don't usually see on a pizza, like broccoli, banana, marshmallow and fish heads.", math: 'a topping can be silly AND a vegetable (broccoli!)', demo: function () { return iconRow(['broccoli', 'banana', 'marshmallow', 'fish-heads']); } },
    // ---- bases and named pizzas ----
    { id: 'base', label: 'Base', syn: ['base', 'sauce'], def: 'The base is the sauce you lay down first, before any toppings. There are three: tomato, cheese and BBQ.', math: 'every slice gets exactly one base', demo: function () { return baseSwatches(); } },
    { id: 'recipe', label: 'Named pizza', syn: ['named pizza', 'recipe'], def: 'A named pizza is a recipe: the name stands for a fixed set of toppings. A Hawaiian means ham and pineapple on a tomato base.', math: 'one name = one base + its toppings', demo: function () { return recipeCard('Hawaiian', 'tomato', ['ham', 'pineapple']); } },
    // ---- choice, counting and rule-strength words ----
    { id: 'eitherOr', label: 'Either / or', syn: ['either or', 'either'], def: 'Either this OR that means pick just ONE of the choices, never both. You decide which one.', math: 'A or B = choose one (not both)', demo: function () { return pairDemo(); } },
    { id: 'atLeast', label: 'At least one', syn: ['at least one', 'at least'], def: 'At least one means one or more: one is fine, two is fine, lots is fine, but never zero.', math: 'at least 1 = 1, 2, 3 ... (1 or more)', demo: function () { return numberLine(6, 1, 6); } },
    { id: 'must', label: 'Must', syn: ['must', 'shall', 'required'], def: 'Must (also shall, or required) means you HAVE to do it. There is no choice: it has to be there.', math: 'MUST = always, you have to', demo: function () { return lit(REG.whole); } },
    { id: 'may', label: 'May', syn: ['may', 'optional', 'recommended', 'should'], def: 'May (also optional, should, recommended) means it is your CHOICE: doing it and skipping it are both allowed.', math: 'MAY = your choice (yes or no)', demo: function () { return mayDemo(); } },
    { id: 'mustNot', label: 'Must not', syn: ['must not', 'shall not', 'should not'], def: 'Must not (also shall not) means NEVER do it. Should not is gentler: better not to, but it is allowed.', math: 'MUST NOT = never do it', demo: function () { return forbiddenDemo(); } }
  ];
  var BY_ID = {}; TERMS.forEach(function (t) { BY_ID[t.id] = t; });

  // concept -> a plain-English sentence shown on the result screen. The words in
  // the sentence are themselves linkified, so they are tappable too.
  var CONCEPTS = {
    whole: 'This order was about covering the WHOLE pizza the same way.',
    half: 'This order was about splitting the pizza into HALVES.',
    quarter: 'This order was about the QUARTERS of the pizza.',
    slice: 'This order was about single SLICES.',
    opposite: 'This order was about two slices OPPOSITE each other.',
    nextTo: 'This order was about slices NEXT TO each other.',
    everyOther: 'This order was about EVERY OTHER slice, going around.',
    diagonal: 'This order was about DIAGONAL quarters, corner to corner.',
    except: 'This order was about doing the whole pizza, except one QUARTER.',
    theRest: 'This order was about a few slices and THE REST.',
    catCount: 'This order was about putting a number of toppings from one group on every SLICE.',
    compare: 'This order was about a number: MORE THAN or FEWER THAN.',
    intersection: 'This order was about the INTERSECTION — where two groups overlap.',
    notTouch: 'This order was about keeping two groups from TOUCHING.',
    ordinalRun: 'This order was about going around in a run, then THE REST.'
  };

  // ---- text linkifying ----
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  // phrases sorted longest-first so "every other slice" beats "slice".
  var PHRASES = [];
  TERMS.forEach(function (t) { t.syn.forEach(function (p) { PHRASES.push({ term: t.id, p: p }); }); });
  PHRASES.sort(function (a, b) { return b.p.length - a.p.length; });
  function rxEsc(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  // wrap the FIRST occurrence of each term's longest matching phrase. One link per
  // term keeps the bubble readable. Operates on escaped HTML.
  function linkify(text, ingredients) {
    var html = esc(text), used = {}, slots = [];
    // Wrap each match as a control-char placeholder first, then swap in the real
    // spans at the end. Placeholders contain no letters, so a shorter phrase
    // (e.g. "must") can never match inside an already-wrapped longer one
    // (e.g. "must not"), which would otherwise nest and corrupt the span.
    PHRASES.forEach(function (ph) {
      if (used[ph.term]) return;
      // Match a whole word that is NOT part of a hyphenated word: \b alone treats
      // a hyphen as a boundary, so \bhalf\b wrongly matches inside "half-birthday".
      // Capture the leading boundary char (m[1]) so no lookbehind is needed.
      var re = new RegExp('(^|[^\\w-])(' + rxEsc(ph.p) + ')(?![\\w-])', 'i');
      var m = re.exec(html);
      if (!m) return;
      used[ph.term] = 1;
      var token = '' + slots.length + '';
      var at = m.index + m[1].length, hit = m[2]; // wrap only the term, keep its leading boundary char
      slots.push('<span class="gloss" data-term="' + ph.term + '">' + hit + '</span>');
      html = html.slice(0, at) + token + html.slice(at + hit.length);
    });
    // Ingredient highlight pass: colour EVERY ingredient/base name a different
    // colour from the glossary terms. This deliberately tempts a child to skim for
    // the food words; doing so they miss the spatial/logic instructions, which is
    // the point. Reuses the same control-char placeholder slots so an ingredient
    // can never nest inside an already-wrapped term span.
    var PH = String.fromCharCode(1);
    (ingredients || []).forEach(function (ing) {
      var re = new RegExp('(^|[^\\w-])(' + rxEsc(ing) + ')(?![\\w-])', 'ig');
      html = html.replace(re, function (whole, lead, word) {
        var tok = PH + slots.length + PH;
        slots.push('<span class="gloss-ing">' + word + '</span>');
        return lead + tok;
      });
    });
    return html.replace(/(\d+)/g, function (_, i) { return slots[i]; });
  }
  function detectTerms(text) {
    var html = ' ' + String(text || '') + ' ', out = [], seen = {};
    PHRASES.forEach(function (ph) {
      if (seen[ph.term]) return;
      if (new RegExp('(^|[^\\w-])' + rxEsc(ph.p) + '(?![\\w-])', 'i').test(html)) { seen[ph.term] = 1; out.push(ph.term); }
    });
    return out;
  }
  function conceptExplanation(order) {
    var s = order && order.concept && CONCEPTS[order.concept];
    if (!s) {
      var found = detectTerms(order ? (order.core || order.text) : '');
      if (found.length) s = 'This order was about: ' + found.map(function (id) { return BY_ID[id].label.toUpperCase(); }).join(', ') + '.';
      else s = 'Read the order carefully. Tap any underlined word to see what it means.';
    }
    return linkify(s);
  }

  // ---- modal + page DOM (built once, appended to body) ----
  // host hooks let the game pause its timers while the glossary is open.
  var modalEl, pageEl, hooks = { pause: function () {}, resume: function () {} };
  function overlay(id) { var d = document.createElement('div'); d.className = 'overlay'; d.id = id; return d; }
  function card(extra) { var d = document.createElement('div'); d.className = 'card ' + (extra || ''); return d; }

  function termCard(t, withClose) {
    var c = card('gloss-card');
    var demo = document.createElement('div'); demo.className = 'gloss-demo'; demo.appendChild(t.demo());
    var h = document.createElement('h2'); h.textContent = t.label; h.className = 'gloss-h';
    var def = document.createElement('p'); def.className = 'gloss-def'; def.textContent = t.def;
    var math = document.createElement('p'); math.className = 'gloss-math'; math.textContent = t.math;
    c.appendChild(demo); c.appendChild(h); c.appendChild(def); c.appendChild(math);
    if (withClose) {
      var b = document.createElement('button'); b.className = 'big box'; b.textContent = 'Got it!';
      b.onclick = closeModal; c.appendChild(b);
    }
    return c;
  }
  function ensureModal() {
    if (modalEl) return;
    modalEl = overlay('gloss-modal-overlay');
    modalEl.addEventListener('click', function (e) { if (e.target === modalEl) closeModal(); });
    document.body.appendChild(modalEl);
  }
  function openTerm(id) {
    var t = BY_ID[id]; if (!t) return;
    ensureModal();
    modalEl.innerHTML = '';
    modalEl.appendChild(termCard(t, true));
    modalEl.classList.add('show');
    hooks.pause();
  }
  function closeModal() { if (modalEl) modalEl.classList.remove('show'); hooks.resume(); }

  // The glossary page is a one-concept-per-page flip book (Back / Next), not a
  // long scroll, so a young child meets one idea at a time.
  // Cards per page adapt to the screen: 4 (a 2x2 grid) when there is room, else
  // 2. Columns track width independently, so the 2-card case is a stacked single
  // column on a narrow phone and a side-by-side pair on a short-but-wide screen.
  var pageIdx = 0, pageBody, pageCount, prevBtn, nextBtn;
  function cols() { return window.innerWidth >= 620 ? 2 : 1; }
  function perPage() { return (window.innerWidth >= 620 && window.innerHeight >= 700) ? 4 : 2; }
  function pageTotal() { return Math.ceil(TERMS.length / perPage()); }
  function renderPage() {
    var pp = perPage();
    pageBody.style.gridTemplateColumns = cols() === 2 ? '1fr 1fr' : '1fr';
    pageIdx = Math.max(0, Math.min(pageTotal() - 1, pageIdx)); // reclamp after a layout change
    pageBody.innerHTML = '';
    var start = pageIdx * pp;
    TERMS.slice(start, start + pp).forEach(function (t) { pageBody.appendChild(termCard(t, false)); });
    pageCount.textContent = (pageIdx + 1) + ' / ' + pageTotal();
    prevBtn.disabled = pageIdx === 0;
    nextBtn.disabled = pageIdx >= pageTotal() - 1;
  }
  function step(d) { pageIdx = Math.max(0, Math.min(pageTotal() - 1, pageIdx + d)); renderPage(); }
  function closePage() { if (pageEl) pageEl.classList.remove('show'); hooks.resume(); }
  function openPage() {
    if (!pageEl) {
      pageEl = overlay('gloss-page-overlay');
      pageEl.addEventListener('click', function (e) { if (e.target === pageEl) closePage(); });
      var c = card('gloss-page-card');
      var h = document.createElement('h2'); h.textContent = '📖 Pizza Words'; c.appendChild(h);
      pageBody = document.createElement('div'); pageBody.className = 'gloss-page-body'; c.appendChild(pageBody);
      var nav = document.createElement('div'); nav.className = 'gloss-nav';
      prevBtn = document.createElement('button'); prevBtn.className = 'big clear'; prevBtn.textContent = '◀ Back';
      prevBtn.onclick = function () { step(-1); };
      pageCount = document.createElement('span'); pageCount.className = 'gloss-count';
      nextBtn = document.createElement('button'); nextBtn.className = 'big box'; nextBtn.textContent = 'Next ▶';
      nextBtn.onclick = function () { step(1); };
      nav.appendChild(prevBtn); nav.appendChild(pageCount); nav.appendChild(nextBtn);
      c.appendChild(nav);
      var b = document.createElement('button'); b.className = 'big clear gloss-close'; b.textContent = 'Close';
      b.onclick = closePage; c.appendChild(b);
      pageEl.appendChild(c);
      document.body.appendChild(pageEl);
      // Re-flow (cards-per-page + column count) when the window crosses a
      // breakpoint while the glossary is open; renderPage reclamps pageIdx.
      window.addEventListener('resize', function () { if (pageEl && pageEl.classList.contains('show')) renderPage(); });
    }
    pageIdx = 0; renderPage();
    pageEl.classList.add('show');
    hooks.pause();
  }

  function init(opts) {
    if (opts && opts.pause) hooks.pause = opts.pause;
    if (opts && opts.resume) hooks.resume = opts.resume;
    // one delegated handler: any .gloss span opens its term.
    document.addEventListener('click', function (e) {
      var g = e.target.closest && e.target.closest('.gloss');
      if (g && g.dataset.term) { e.preventDefault(); openTerm(g.dataset.term); }
    });
  }

  window.Glossary = { linkify: linkify, conceptExplanation: conceptExplanation, openTerm: openTerm, openPage: openPage, init: init, TERMS: TERMS };
})();
