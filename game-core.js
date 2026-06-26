/*
 * game-core.js - pure game logic for Pizza Shop, no DOM.
 *
 * UMD-style: exposes `Core` on the browser global, and module.exports under node
 * so tools/test-core.js can require() it. Classic script (not an ES module) so it
 * loads from file:// with no server.
 *
 * Responsibilities: pizza geometry, the ingredient/recipe data, the order
 * generator + English renderer, and the grader (acceptable-layouts model:
 * pinned / ambiguous-orbit / enumerated-set / wildcard). The UI never grades;
 * it only renders state and reports the player's layout back here.
 */
(function (root, factory) {
  if (typeof module !== 'undefined' && module.exports) module.exports = factory();
  else root.Core = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Geometry. 8 wedges, indexed 0..7 clockwise from 12 o'clock. Wedge i spans
  // [45*i, 45*(i+1)) degrees clockwise from the top, so wedge boundaries land on
  // the vertical and horizontal axes and every half is a clean 4-wedge set.
  // ---------------------------------------------------------------------------
  var N = 8;

  // Derived once from the angle rule above (see README for the derivation).
  var REGION = {
    whole: [0, 1, 2, 3, 4, 5, 6, 7],
    right: [0, 1, 2, 3],
    left: [4, 5, 6, 7],
    top: [0, 1, 6, 7],
    bottom: [2, 3, 4, 5],
    'top-right': [0, 1],
    'bottom-right': [2, 3],
    'bottom-left': [4, 5],
    'top-left': [6, 7]
  };

  // Human names for single wedges, used in feedback when an order pins one slice.
  var SLICE_NAME = [
    'the 1-o’clock slice', 'the 2-o’clock slice',
    'the 4-o’clock slice', 'the 5-o’clock slice',
    'the 7-o’clock slice', 'the 8-o’clock slice',
    'the 10-o’clock slice', 'the 11-o’clock slice'
  ];

  function opposite(i) { return (i + 4) % N; }
  function neighbours(i) { return [(i + N - 1) % N, (i + 1) % N]; }

  // ---------------------------------------------------------------------------
  // Symmetry transforms over the 8 wedges. A transform is a permutation `perm`
  // mapping an old wedge index to a new one: applyPerm(L)[perm[i]] = L[i].
  // Used to expand an ambiguous order's canonical layout into its acceptable
  // orbit (e.g. "any quarter" -> all rotations).
  // ---------------------------------------------------------------------------
  function rot(k) { var p = []; for (var i = 0; i < N; i++) p[i] = (i + k) % N; return p; }
  // Mirror across the vertical axis: wedge i -> wedge (7-i) (derived from angles).
  function reflectV() { var p = []; for (var i = 0; i < N; i++) p[i] = (7 - i + N) % N; return p; }

  function applyPerm(layout, perm) {
    var out = new Array(N);
    for (var i = 0; i < N; i++) out[perm[i]] = cloneSlice(layout[i]);
    return out;
  }
  var ALL_ROTATIONS = [];
  for (var _k = 0; _k < N; _k++) ALL_ROTATIONS.push(rot(_k));

  // ---------------------------------------------------------------------------
  // Slice / layout model. A slice = { base, toppings:[ids sorted unique] }.
  // base is one of BASE ids; default/plain base is 'plain'.
  // ---------------------------------------------------------------------------
  function normToppings(arr) {
    var seen = {}, out = [];
    (arr || []).forEach(function (t) { if (!seen[t]) { seen[t] = 1; out.push(t); } });
    out.sort();
    return out;
  }
  function makeSlice(base, toppings) { return { base: base || 'plain', toppings: normToppings(toppings) }; }
  function cloneSlice(s) {
    if (s.wildcard) {
      var w = { wildcard: true, nonBare: !!s.nonBare };
      if (s.surpriseAgainst) w.surpriseAgainst = s.surpriseAgainst.slice();
      return w;
    }
    if (s.catCount) return { catCount: true, base: s.base, cat: s.cat, count: s.count, min: s.min, max: s.max, phrase: s.phrase };
    return { base: s.base, toppings: s.toppings.slice() };
  }
  function emptyLayout() { var L = []; for (var i = 0; i < N; i++) L.push(makeSlice('plain', [])); return L; }
  function cloneLayout(L) { return L.map(cloneSlice); }
  function isBare(s) { return s.base === 'plain' && s.toppings.length === 0; }

  function setEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  // Paint a region of a layout. mode 'base' sets the base; mode 'add' adds a
  // topping; mode 'set' replaces toppings.
  function paint(layout, indices, opts) {
    indices.forEach(function (i) {
      var s = layout[i];
      if (opts.base) s.base = opts.base;
      if (opts.addTopping) s.toppings = normToppings(s.toppings.concat([opts.addTopping]));
      if (opts.setToppings) s.toppings = normToppings(opts.setToppings);
      if (opts.plain) { s.base = 'plain'; s.toppings = []; }
    });
    return layout;
  }

  // ---------------------------------------------------------------------------
  // Ingredients, bases, recipes (mirror of the plan's catalogue).
  // ---------------------------------------------------------------------------
  // 'plain' is the default/bare dough: the pizza starts with no base on it.
  var BASES = {
    plain: { name: 'No base', color: '#f2d8a8' },
    tomato: { name: 'Tomato base', color: '#cf3a22' },
    cheese: { name: 'Cheese base', color: '#f1c40f' },
    bbq: { name: 'BBQ base', color: '#9c5a23' }
  };

  // emoji used by the UI as a quick, licence-free icon for each topping.
  var TOPPING = {
    pepperoni: { name: 'pepperoni', icon: '🔴' },
    ham: { name: 'ham', icon: '🍖' },
    bacon: { name: 'bacon', icon: '🥓' },
    sausage: { name: 'sausage', icon: '🌭' },
    meatball: { name: 'meatball', icon: '🧆' },
    chicken: { name: 'chicken', icon: '🍗' },
    mushroom: { name: 'mushroom', icon: '🍄' },
    pepper: { name: 'pepper', icon: '🫑' },
    onion: { name: 'onion', icon: '🧅' },
    olive: { name: 'olive', icon: '⚫' },
    spinach: { name: 'spinach', icon: '🍃' },
    sweetcorn: { name: 'sweetcorn', icon: '🌽' },
    pineapple: { name: 'pineapple', icon: '🍍' },
    'tomato-slice': { name: 'tomato slice', icon: '🍅' }, // "slice" disambiguates from the tomato BASE
    chilli: { name: 'chilli', icon: '🌶️' },
    'extra-cheese': { name: 'extra cheese', icon: '🧀' },
    // novelty: foods a kid finds absurd on a pizza.
    broccoli: { name: 'broccoli', icon: '🥦', novelty: true },
    'green-beans': { name: 'green beans', icon: '🫘', novelty: true },
    'brussels-sprout': { name: 'Brussels sprout', icon: '🥬', novelty: true },
    peas: { name: 'peas', icon: '🟢', novelty: true },
    beetroot: { name: 'beetroot', icon: '🟣', novelty: true },
    banana: { name: 'banana', icon: '🍌', novelty: true },
    raisins: { name: 'raisins', icon: '🍇', novelty: true }, // dried grapes; no raisin emoji exists
    marshmallow: { name: 'marshmallow', icon: '⚪', novelty: true }, // white blob; no marshmallow emoji exists
    'fish-heads': { name: 'fish heads', icon: '🐟', novelty: true }
  };

  // Order in which ingredients become available (one at a time). Bases unlock
  // alongside their first recipe; tracked separately by the UI.
  // Funny "novelty" ingredients are sprinkled in EARLY (banana by the 5th unlock,
  // ~tier 3) so kids get the "X on a PIZZA?!" laugh before the late game, not just
  // a wall of serious toppings. The truly weird ones (beetroot/raisins/marshmallow)
  // still come last.
  var UNLOCK_ORDER = [
    'pepperoni', 'mushroom', 'ham', 'cheese-base', 'banana', 'olive', 'broccoli',
    'pineapple', 'onion', 'sweetcorn', 'green-beans', 'pepper', 'spinach', 'bbq-base', 'peas',
    'bacon', 'sausage', 'meatball', 'chicken', 'tomato-slice', 'chilli',
    'brussels-sprout', 'extra-cheese', 'beetroot', 'raisins', 'marshmallow', 'fish-heads'
  ];

  // Recipes: name -> { base, toppings }. Lives only here; never a tray chip.
  function R(base, toppings) { return { base: base, toppings: normToppings(toppings) }; }
  // Every recipe is built from ingredients the tray actually offers: one real
  // base (tomato/cheese/bbq, never 'plain') plus toppings that each have a chip.
  // Cheese is a BASE, not a hidden topping layer, so "a Popeye Power-Up is cheese
  // and spinach" is buildable as exactly a cheese base + spinach.
  var RECIPE = {
    'Margherita': R('cheese', ['tomato-slice']),
    'Pepperoni Classic': R('cheese', ['pepperoni']),
    'Hawaiian': R('tomato', ['ham', 'pineapple']),
    'Cheesy Cheese Dream': R('cheese', ['extra-cheese']),
    'Meat Feast': R('tomato', ['pepperoni', 'ham', 'sausage', 'bacon']),
    'Veggie Supreme': R('tomato', ['mushroom', 'pepper', 'onion', 'sweetcorn', 'olive']),
    'BBQ Chicken': R('bbq', ['chicken', 'onion']),
    'Dragon’s Breath': R('tomato', ['chilli', 'pepperoni', 'onion']),
    'Popeye Power-Up': R('cheese', ['spinach']),
    'Gone Bananas': R('tomato', ['banana', 'ham']),
    'Lunchbox Tragedy': R('tomato', ['broccoli', 'green-beans', 'peas'])
  };

  function expandRecipe(name) {
    var r = RECIPE[name];
    if (!r) throw new Error('unknown recipe: ' + name);
    return { base: r.base, toppings: r.toppings.slice() };
  }

  // A recipe is buildable only when every ingredient it needs is unlocked.
  function ingredientUnlocked(id, unlocked) {
    return unlocked.indexOf(id) !== -1;
  }
  function recipeBuildable(name, unlocked) {
    var r = RECIPE[name];
    if (!r) return false;
    if (r.base === 'cheese' && unlocked.indexOf('cheese-base') === -1) return false;
    if (r.base === 'bbq' && unlocked.indexOf('bbq-base') === -1) return false;
    for (var i = 0; i < r.toppings.length; i++) {
      if (!ingredientUnlocked(r.toppings[i], unlocked)) return false;
    }
    return true;
  }
  // Recipes ordered easy -> hard, so early tiers reach for the simple ones.
  var RECIPE_ORDER = [
    'Pepperoni Classic', 'Margherita', 'Popeye Power-Up', 'Hawaiian', 'BBQ Chicken',
    'Cheesy Cheese Dream', 'Veggie Supreme', 'Dragon’s Breath', 'Meat Feast',
    'Gone Bananas', 'Lunchbox Tragedy'
  ];
  function buildableRecipes(unlocked, max) {
    var out = [];
    for (var i = 0; i < RECIPE_ORDER.length && out.length < (max || 99); i++) {
      if (recipeBuildable(RECIPE_ORDER[i], unlocked)) out.push(RECIPE_ORDER[i]);
    }
    return out;
  }
  // English list of a recipe's ingredients, for the scaffolded definition.
  function recipeWords(name) {
    var parts = RECIPE[name].toppings.map(toppingName);
    if (parts.length === 1) return parts[0];
    return parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1];
  }
  // Full spoken description including the BASE, for a recipe's first (scaffolded)
  // mention so the player knows which base to lay: e.g. "a cheese base with
  // spinach", "a tomato base with ham and pineapple".
  function recipeDescribe(name) {
    var r = RECIPE[name];
    return 'a ' + baseWord(r.base) + ' base' + (r.toppings.length ? ' with ' + recipeWords(name) : '');
  }
  // Always-on reminder of one or more recipes' contents. Used by COMPLEX orders
  // (2+ recipes, or a recipe transform): the player should never have to recall
  // several recipe compositions from memory, so these never fully fade.
  function recipeReminder(names) {
    return ' (Reminder: ' + names.map(function (nm) { return nm + ' is ' + recipeDescribe(nm); }).join('; ') + '.)';
  }
  function untaught(names, taught) { return names.filter(function (nm) { return !knownRecipe(nm, taught); }); }
  // Paint a recipe over a region: its real base + its full topping set (so a
  // single slice carries MULTIPLE toppings).
  function paintRecipe(L, indices, name) {
    var r = RECIPE[name];
    paint(L, indices, { base: r.base, setToppings: r.toppings });
    return L;
  }

  // ---------------------------------------------------------------------------
  // Grading. score = average per-slice score over the best-matching acceptable
  // layout. Per slice: 0.5 for correct base + 0.5 for correct topping-set.
  // A spec slice may be { wildcard:true, nonBare?:true } meaning "any fill".
  // ---------------------------------------------------------------------------
  // Topping overlap as an F1 score: rewards each correctly-placed topping and
  // PENALISES both missing toppings (false negatives) and misplaced/extra ones
  // (false positives). Two empty sets match perfectly. This is what lets "right
  // topping, wrong slice" score below a clean build instead of getting full
  // topping credit for smearing one ingredient everywhere.
  function toppingF1(playerToppings, wantToppings) {
    if (playerToppings.length === 0 && wantToppings.length === 0) return 1;
    var want = {}; wantToppings.forEach(function (t) { want[t] = 1; });
    var tp = 0; playerToppings.forEach(function (t) { if (want[t]) tp++; });
    var fp = playerToppings.length - tp, fn = wantToppings.length - tp;
    var denom = 2 * tp + fp + fn;
    return denom === 0 ? 1 : (2 * tp) / denom;
  }
  // Per-slice score: base is one binary choice (de-weighted to 0.4 so a correct
  // base can't, on its own, prop a badly-placed pizza up to a pass), toppings are
  // graded (0.6) and carry the spatial-placement signal that is the actual lesson.
  function sliceScore(playerSlice, spec) {
    if (spec.wildcard) {
      if (isBare(playerSlice)) return spec.nonBare ? 0 : 1;
      // "Surprise me": a free slice must be the player's OWN choice, not a copy
      // of what the order already named and not empty. Echoing the named topping
      // (or leaving it bare) is not a surprise and scores 0; adding any topping
      // the order did not ask for counts.
      if (spec.surpriseAgainst) {
        var fresh = playerSlice.toppings.some(function (t) { return spec.surpriseAgainst.indexOf(t) === -1; });
        return fresh ? 1 : 0;
      }
      return 1;
    }
    // Category-count: a fixed base plus a number of distinct toppings, all from a
    // category. Either EXACTLY `count` ("any 3 different meats") or a range via
    // min/max ("more than two meats" = min 3; "fewer than five" = max 4). The
    // player picks which toppings.
    if (spec.catCount) {
      var bOk = playerSlice.base === spec.base ? 1 : 0;
      var test = catTest(spec.cat);
      var tops = playerSlice.toppings;
      var lo = spec.min != null ? spec.min : spec.count;
      var hi = spec.max != null ? spec.max : spec.count;
      var tOk = (tops.length >= lo && tops.length <= hi && tops.every(test)) ? 1 : 0;
      return 0.4 * bOk + 0.6 * tOk;
    }
    var baseOk = playerSlice.base === spec.base ? 1 : 0;
    var topScore = toppingF1(playerSlice.toppings, normToppings(spec.toppings));
    return 0.4 * baseOk + 0.6 * topScore;
  }
  function layoutScore(player, acceptableLayout) {
    var sum = 0;
    for (var i = 0; i < N; i++) sum += sliceScore(player[i], acceptableLayout[i]);
    return sum / N;
  }
  // acceptable: array of layouts (each an array of 8 spec-slices).
  function grade(player, acceptable) {
    var best = -1, bestLayout = acceptable[0];
    for (var j = 0; j < acceptable.length; j++) {
      var s = layoutScore(player, acceptable[j]);
      if (s > best) { best = s; bestLayout = acceptable[j]; }
    }
    return { accuracy: best, closest: bestLayout };
  }

  // ---------------------------------------------------------------------------
  // Multi-pizza POOL grading (the two-board count/fraction mechanic).
  //
  // A pool order is ONE flat list of slices (16 for two pizzas) plus a multiset
  // of required KINDS: [{ spec, count }] whose counts sum to the slice total.
  // Arrangement is free, so the score is the BEST one-to-one assignment of the
  // player's slices to the required kind-slots, maximising summed sliceScore.
  // accuracy = total / sliceCount, so a clean build of 15/16 correct = 0.9375.
  //
  // Solved exactly with the Hungarian (Kuhn-Munkres) algorithm on the square
  // cost matrix (each kind expanded into `count` identical columns), cost =
  // 1 - sliceScore so minimising cost maximises score. n<=16 so O(n^3) is cheap.
  // ---------------------------------------------------------------------------
  function hungarianMinCost(cost) {
    var n = cost.length;
    if (n === 0) return 0;
    var INF = Infinity;
    var u = new Array(n + 1).fill(0), v = new Array(n + 1).fill(0);
    var p = new Array(n + 1).fill(0), way = new Array(n + 1).fill(0);
    for (var i = 1; i <= n; i++) {
      p[0] = i;
      var j0 = 0;
      var minv = new Array(n + 1).fill(INF);
      var used = new Array(n + 1).fill(false);
      do {
        used[j0] = true;
        var i0 = p[j0], delta = INF, j1 = 0;
        for (var j = 1; j <= n; j++) if (!used[j]) {
          var cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
          if (cur < minv[j]) { minv[j] = cur; way[j] = j0; }
          if (minv[j] < delta) { delta = minv[j]; j1 = j; }
        }
        for (j = 0; j <= n; j++) {
          if (used[j]) { u[p[j]] += delta; v[j] -= delta; }
          else minv[j] -= delta;
        }
        j0 = j1;
      } while (p[j0] !== 0);
      do { var j1b = way[j0]; p[j0] = p[j1b]; j0 = j1b; } while (j0);
    }
    var total = 0;
    for (var jj = 1; jj <= n; jj++) total += cost[p[jj] - 1][jj - 1];
    return total;
  }
  // poolKinds: [{ spec, count }]; spec is a normal slice spec (fixed slice, or a
  // recipe already expanded to {base,toppings}). Counts must sum to player.length.
  function gradePool(player, poolKinds) {
    var n = player.length;
    var cols = [];
    poolKinds.forEach(function (k) { for (var c = 0; c < k.count; c++) cols.push(k.spec); });
    if (cols.length !== n) {
      // counts must tile the slice pool exactly; a mismatch is a generator bug.
      throw new Error('gradePool: kind counts (' + cols.length + ') != slices (' + n + ')');
    }
    var cost = [];
    for (var i = 0; i < n; i++) {
      var row = [];
      for (var j = 0; j < n; j++) row.push(1 - sliceScore(player[i], cols[j]));
      cost.push(row);
    }
    var total = n - hungarianMinCost(cost); // each cell = 1 - score
    return { accuracy: total / n };
  }
  // Reduce a slice count over the total to its lowest-terms fraction, for the
  // teaching reveal: reduceFraction(10, 16) -> [5, 8].
  function gcd(a, b) { return b ? gcd(b, a % b) : a; }
  function reduceFraction(num, den) { var g = gcd(num, den) || 1; return [num / g, den / g]; }

  // Region-phrased diff of player vs the closest acceptable layout.
  function describeMistakes(player, closest) {
    var msgs = [];
    for (var i = 0; i < N; i++) {
      var spec = closest[i];
      var p = player[i];
      if (spec.wildcard) {
        // free slice: only a problem if it wasn't a genuine surprise.
        if (sliceScore(p, spec) < 1) {
          msgs.push({
            slice: i, where: SLICE_NAME[i], surprise: true,
            wantBase: '', gotBase: BASES[p.base].name,
            wantToppings: ['a surprise of your own (not a copy, not bare)'],
            gotToppings: p.toppings.map(toppingName)
          });
        }
        continue;
      }
      if (spec.catCount) {
        if (sliceScore(p, spec) < 1) {
          msgs.push({
            slice: i, where: SLICE_NAME[i],
            wantBase: BASES[spec.base].name, gotBase: BASES[p.base].name,
            wantToppings: [spec.phrase ? spec.phrase : ('any ' + spec.count + ' different ' + catWord(spec.cat))],
            gotToppings: p.toppings.map(toppingName)
          });
        }
        continue;
      }
      var baseOk = p.base === spec.base;
      var topOk = setEqual(p.toppings, normToppings(spec.toppings));
      if (baseOk && topOk) continue;
      msgs.push({
        slice: i,
        where: SLICE_NAME[i],
        wantBase: BASES[spec.base].name,
        gotBase: BASES[p.base].name,
        wantToppings: spec.toppings.map(toppingName),
        gotToppings: p.toppings.map(toppingName)
      });
    }
    return msgs;
  }
  function toppingName(id) {
    if (id === 'cheese-as-topping') return 'cheese';
    return TOPPING[id] ? TOPPING[id].name : id;
  }

  // Expand a single canonical layout into an acceptable orbit under a list of
  // permutations, de-duplicating identical results.
  function orbit(canonical, perms) {
    var out = [], seen = {};
    perms.forEach(function (p) {
      var L = applyPerm(canonical, p);
      var key = JSON.stringify(L);
      if (!seen[key]) { seen[key] = 1; out.push(L); }
    });
    return out;
  }

  // ---------------------------------------------------------------------------
  // Order generator + English renderer.
  //
  // generateOrder({ordersServed, unlocked, rng}) -> {
  //   tier, text, acceptable:[layout...], teach:{type,...}|null, novelty:bool
  // }
  // Every template builds a canonical layout, then derives the acceptable list
  // (pinned = [canonical]; ambiguous = orbit/enumeration). The English is
  // rendered from the same structured choice, never parsed back.
  // ---------------------------------------------------------------------------
  function defaultRng() { return Math.random(); }
  function pick(rng, arr) { return arr[Math.floor(rng() * arr.length)]; }
  function pickN(rng, arr, n) {
    var pool = arr.slice(), out = [];
    while (out.length < n && pool.length) out.push(pool.splice(Math.floor(rng() * pool.length), 1)[0]);
    return out;
  }

  var REGION_WORD = { left: 'left', right: 'right', top: 'top', bottom: 'bottom' };
  var OPP_HALF = { left: 'right', right: 'left', top: 'bottom', bottom: 'top' };
  var QUARTER_WORD = {
    'top-left': 'top-left', 'top-right': 'top-right',
    'bottom-left': 'bottom-left', 'bottom-right': 'bottom-right'
  };
  var HALVES = ['left', 'right', 'top', 'bottom'];
  var QUARTERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

  // Dihedral group of the 8 wedges: 8 rotations + 8 reflections. Used so an
  // ambiguous order accepts every rotation/flip of its canonical layout.
  var V_REFLECT = reflectV(); // mirror left<->right, keeps top/bottom
  var DIHEDRAL = [];
  for (var _k2 = 0; _k2 < N; _k2++) {
    DIHEDRAL.push(rot(_k2));
    var _rf = [];
    for (var _i2 = 0; _i2 < N; _i2++) _rf[_i2] = ((7 - _i2) + _k2) % N;
    DIHEDRAL.push(_rf);
  }
  // Handing a pizza across the counter flips left<->right but not top/bottom, so
  // EVERY order also accepts its vertical mirror. Pinned orders -> {self, mirror};
  // ambiguous orders -> the full rotation+reflection orbit.
  function pinnedAcc(L) { return orbit(L, [rot(0), V_REFLECT]); }
  function rotAcc(L) { return orbit(L, DIHEDRAL); }

  // Bases. Tomato is the everyday base; the pizza starts bare ('plain').
  function pickBase(rng, unlocked) {
    var o = ['tomato', 'tomato', 'tomato'];
    if (unlocked && unlocked.indexOf('cheese-base') !== -1) o.push('cheese');
    if (unlocked && unlocked.indexOf('bbq-base') !== -1) o.push('bbq');
    return pick(rng, o);
  }
  function baseWord(b) { return b === 'tomato' ? 'tomato' : (b === 'cheese' ? 'cheese' : (b === 'bbq' ? 'BBQ' : 'plain')); }

  // Pick what an otherwise-bare "rest" region should hold. Big empty-base areas
  // were boring, so most of the time fill them with a CONTRASTING topping and
  // only occasionally leave them as just base (the "everything else plain" idea
  // still appears, just far less often).
  function restTopping(rng, av, exclude) {
    if (rng() < 0.25) return null;
    var pool = av.filter(function (t) { return exclude.indexOf(t) === -1; });
    return pool.length ? pick(rng, pool) : null;
  }

  // --- Creative wrappers. A greeting (always) + optional story (higher tiers) +
  // the precise order + an optional sign-off. The combinatorics give well over
  // 100 distinct phrasings per complexity while the order instruction itself
  // stays exact and gradeable. Story lines are deliberate distractors at higher
  // tiers (the child must read past them).
  var GREET = [
    'Oh, hello there!', 'Ciao, chef!', 'Hiya!', 'Buongiorno!', 'Well well well, a real pizza chef!',
    'Howdy!', 'Knock knock, pizza time!', 'Ahoy there, matey!', 'Hey superstar!', 'Greetings, pizza wizard!',
    'Top of the morning to you!', 'Yo, chef!', 'Hello, hello, hello!', 'Pizza me up, please!', 'Good day to you!',
    'Right then, let’s do this!', 'Phew, made it just in time!', 'Bonjour, pizza genius!', 'G’day!',
    'Excuse me, are you the famous chef?', 'Hellooo, anybody hungry? Oh wait, that’s me!', 'Cooee!',
    'Stop everything, I have arrived!', 'Pardon me, coming through!', 'Salutations, slice-master!'
  ];
  // Distractor narratives, deliberately varied so a child reads many different
  // little stories: different reasons (birthdays, sport, pets, school, weather,
  // journeys, gatherings of different sizes) and different tones. These are NOISE
  // the player must read past; none of them change the pizza.
  var STORY = [
    // birthdays & celebrations
    'It’s my dragon’s birthday, so this has to be perfect.', 'I just turned seven and a half, so it’s basically my birthday.',
    'We’re celebrating, my tooth finally fell out!', 'It’s my hamster’s gotcha-day, a very big deal in our house.',
    'My team won the spelling bee, so we’re having a feast.', 'I just beat my big brother at chess, so I’m celebrating.',
    'It’s my half-birthday, which my mum says still counts.', 'My baby sister said her first word today: “pizza”, obviously.',
    // sport & school
    'The whole football team is starving back home.', 'I scored the winning goal, so the snack is on me.',
    'I aced my times tables, so Mum promised me pizza.', 'My swimming class made me hungry as a hippo.',
    'Sports day was today and I came third in the sack race.', 'I finished my reading book all by myself this week.',
    // pets & animals
    'My cat absolutely insisted I order this exact one.', 'My goldfish is watching from his bowl, so make it good.',
    'My puppy chewed my shoe, so I’m comfort-eating, honestly.', 'The class hamster escaped again, so I need cheering up.',
    'My parrot keeps shouting “pizza” and I gave in.', 'My pet snail is very slow, so I came on ahead to order.',
    // journeys & weather
    'I walked twelve whole miles for this, no joke.', 'It’s raining frogs outside, so I need cheering up.',
    'I rode my scooter all the way across town for this.', 'It’s so windy my hat flew off twice on the way here.',
    'I got the bus, then a train, then hopped the last bit.', 'It started snowing, so obviously I need a hot pizza.',
    'My spaceship runs on pizza, believe it or not.', 'I time-travelled here from the year 3000 just for a slice.',
    // family gatherings, different sizes
    'We’re having a tiny party, just the two of us, very fancy.', 'There are six cousins at my house and they’re LOUD.',
    'Grandma, grandpa and all the aunties are visiting at once.', 'It’s movie night and there are nine of us on the sofa.',
    'My twin brothers eat double, so I came prepared.', 'Just me tonight, but I’m extremely hungry, so it counts.',
    'The whole street is having a picnic and I drew the short straw.', 'My big noisy family is back home arguing over toppings.',
    // silly excuses & adventures
    'My gran says yours is the best in the entire town.', 'I’m training to be a world-class pizza taster, you see.',
    'I lost a bet and the prize is pizza, somehow.', 'My robot helper is on a break, so it’s all up to you.',
    'I’ve got the hiccups and only pizza ever fixes them.', 'The king of Nowhere-Land sent me, very important business.',
    'I’m extremely hungry and slightly dramatic about it.', 'I’ve been very brave at the dentist, so I earned a treat.',
    'There’s a monster under my bed who only eats pizza.', 'My homework ate my dog, long story, anyway, pizza.',
    'It’s national pizza day on my planet, so this is serious.', 'I’m a secret agent and this pizza is my disguise.',
    'My grandpa dared me to order the silliest pizza ever.', 'I just learned to whistle and I’m celebrating with food.',
    'The wizard next door turned my lunch into a frog.', 'I’ve been dreaming about this pizza all week long.',
    'I built a blanket fort and you can’t have a fort without pizza.', 'My imaginary friend is also hungry, so make it big.',
    'I tidied my whole room without being asked, can you believe it.', 'A pirate told me this was the best treasure in town.',
    'My welly boots are full of puddle and I need cheering up.', 'I’m on a very important quest and pizza is step one.',
    'My tummy has been rumbling like a thunderstorm all day.', 'I drew you a picture but I ate it, sorry, so, pizza.'
  ];
  var SIGN = [
    'Grazie!', 'You’re the best!', 'Thanks a million!', 'Cheers, chef!', 'Mwah!',
    'You’re an absolute legend!', 'Pretty please!', 'Make it snappy!', 'Bless your socks!', 'Ta very much!',
    'I believe in you!', 'No pressure… okay, maybe some pressure!', 'My tummy thanks you in advance!',
    'You rock, chef!', 'Easy peasy, right?', 'I’ll wait right here, twiddling my thumbs!', 'Chop chop!',
    'You’ve got this!', 'Knock my socks off!'
  ];
  function cap(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  // NOP red herrings: they mention a topping the order does NOT use, so the right
  // move is to ignore them. `<X>` is filled with a topping absent from the order.
  var NOP = [
    'I’m really not feeling like <X> today.',
    'My brother loves <X>, but please, none for me.',
    'Whatever you do, keep the <X> far away!',
    'Oh, and absolutely no <X>, thank you!',
    'Don’t you dare sneak any <X> on there!',
    'I went right off <X> ages ago, so skip it.',
    'People keep offering me <X>. Not today!'
  ];
  function collectToppings(layout) {
    var seen = {};
    layout.forEach(function (s) { if (!s.wildcard && !s.catCount) s.toppings.forEach(function (t) { seen[t] = 1; }); });
    return seen;
  }
  // a NOP line naming a topping that is NOT in `used`, so it changes nothing.
  function nopLine(rng, used) {
    var pool = Object.keys(TOPPING).filter(function (id) { return !used[id]; });
    if (!pool.length) return null;
    return pick(rng, NOP).replace('<X>', tn(pick(rng, pool)));
  }
  function compose(rng, core, tier, used) {
    var out = pick(rng, GREET) + ' ';
    if (tier >= 3 && rng() < 0.75) out += pick(rng, STORY) + ' ';
    out += cap(core);
    // a red-herring "no <topping>" clause the child must read past (higher tiers)
    if (tier >= 6 && rng() < 0.4 && used) { var nl = nopLine(rng, used); if (nl) out += ' ' + nl; }
    if (rng() < 0.65) out += ' ' + pick(rng, SIGN);
    return out;
  }

  // 20 difficulty tiers. Tier is driven by adaptive difficulty (tips raise it,
  // fails/timeouts lower it); TIER_AT is ONLY a first-play seed for a player with
  // no stored difficulty, never a gate on a returning player.
  var MAX_TIER = 20;
  var TIER_AT = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  function tierFor(ordersServed) {
    var t = 1;
    for (var i = 0; i < TIER_AT.length; i++) if (ordersServed >= TIER_AT[i]) t = i + 1;
    return Math.min(MAX_TIER, t);
  }

  // Toppings available to the generator: unlocked, minus the bases.
  function availableToppings(unlocked) {
    return UNLOCK_ORDER.filter(function (id) {
      return TOPPING[id] && unlocked.indexOf(id) !== -1;
    });
  }

  // All distinct permutations of a multiset (used by the share template).
  function permutations(items) {
    if (items.length <= 1) return [items.slice()];
    var out = [], seen = {};
    for (var i = 0; i < items.length; i++) {
      if (seen[items[i]]) continue;
      seen[items[i]] = 1;
      var rest = items.slice(0, i).concat(items.slice(i + 1));
      permutations(rest).forEach(function (p) { out.push([items[i]].concat(p)); });
    }
    return out;
  }

  // Each template returns an order or null (if it can't be built from `av`).
  // Every order lays a base first; the canonical layout always has a base under
  // each topping (the UI enforces base-before-toppings). Signature (rng, av, un).
  function templatesForTier(tier) {
    // 20 tiers, escalating: whole -> halves -> quarters/counts -> relations &
    // negation & categories -> combos & multi-topping -> inference & composition.
    // Multi-topping (double/triple-half) is sprinkled from the mid tiers so 2-3
    // toppings on one slice are common before recipes. The dense, multi-clause,
    // composite templates own the top tiers; Level 20 draws only composites, so
    // it is never an easy order in disguise. buildOne() falls back to a lower
    // tier if a template can't build from the unlocked ingredients.
    var T = {
      1: [t1_whole],
      2: [t2_halfHalf, t_doubleWhole, t1_whole],
      3: [t4_quarterRest, t2_halfHalf, t_doubleHalf, t_theOther],
      4: [t_threeRegion, t4_twoQuarters, t_doubleHalf, t_theOther],
      5: [t4_twoQuarters, t4_threeQuarters, t_doubleHalf],
      6: [t5_oneSlice, t5_twoAdjacent, t_tripleHalf, t_pronoun],
      7: [t5_twoAdjacent, t5_threeAdjacent, t_tripleHalf, t_riddle],
      8: [t5_oneSlice, t6_oppositeOf, t_doubleHalf, t_pronoun, t_riddle],
      9: [t6_oppositeOf, t_catSeparate, t7_negationBase, t_sillyEvery, t_fruitEvery, t_atLeastOne],
      10: [t6_exceptQuarter, t_catSeparate, t7_negationBase, t_catCountWhole, t_fruitEvery, t_countCompare],
      11: [t6_diagonalQuarters, t6_exceptQuarter, t7_selfCorrect, t_catCountWhole, t_countCompare, t_sharedProperty, t_countCompareHalves],
      12: [t7_alternating, t7_twoBases, t7_selfCorrect, t6_diagonalQuarters, t_countCompare, t_countCompareHalves, t_checkerboard],
      13: [t7_ordinalRun, t7_alternating, t7_wildcard, t_twoBaseConditional, t_checkerboard],
      // tiers 14+ carry the harder LOGIC constructs (inference, either/or, not-both,
      // set intersection, conditional, elimination) alongside the combo templates.
      14: [t_comboWhole, t_comboHalves, t_doubleHalf, t_catCountHalves, t_twoBaseConditional, t_dietary, t_eitherOr, t_notException, t_altRecipes],
      15: [t_comboHalves, t_comboQuarter, t_tripleHalf, t_threeBases, t_recipeRemove, t_eitherOr, t_intersectionCat, t_normative, t_altRecipes],
      16: [t_comboQuarter, t7_nestedException, t7_share, t7_namedDiagonal, t_recipeSwap, t_intersectionCat, t_conditionTrue, t_notException],
      17: [t8_fourQuarters, t_composite3, t7_inOrderDistractor, t_threeBaseConditional, t_gapShare, t_recipeHalfMinus, t_notBoth, t_elimination],
      18: [t_composite3, t10_perSlice, t7_constraint, t7_layerConditional, t_threeBaseConditional, t_normative, t_unevenShare],
      19: [t_composite4, t_dietaryShare, t20_recipeHalvesException, t9_quarterRecipes, t11_compound, t_unevenShare, t_bufferRing],
      20: [t_composite4, t_dietaryShare, t20_recipeHalvesException, t9_quarterRecipes, t_bufferRing]
    };
    return T[tier] || T[1];
  }

  // Ingredient categories, so orders can talk about "the meat" and "the veggies"
  // as groups (e.g. "the veggie slices must not touch the meat").
  // Three DISJOINT categories. "Silly" (the novelty foods) is its own group, NOT
  // a kind of veg, so "any vegetable" never returns broccoli and "a silly pizza"
  // draws only from the silly set.
  var MEAT = { pepperoni: 1, ham: 1, bacon: 1, sausage: 1, meatball: 1, chicken: 1 };
  // VEG includes the silly vegetables: broccoli is silly AND still a vegetable, so it
  // must satisfy a "3 vegetables" order too. VEG and SILLY overlap on purpose; only
  // banana/raisins/marshmallow are silly-but-not-veg. MEAT stays disjoint from both.
  var VEG = {
    mushroom: 1, pepper: 1, onion: 1, olive: 1, spinach: 1, sweetcorn: 1, 'tomato-slice': 1,
    broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1, beetroot: 1
  };
  var SILLY = { broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1, beetroot: 1, banana: 1, raisins: 1, marshmallow: 1, 'fish-heads': 1 };
  // FRUIT overlaps SILLY (banana, raisins) the same way VEG does; pineapple is a
  // normal topping that is also a fruit. Only 3 fruits exist in the palette.
  var FRUIT = { pineapple: 1, banana: 1, raisins: 1 };
  function isMeat(id) { return !!MEAT[id]; }
  function isVeg(id) { return !!VEG[id]; }
  function isSilly(id) { return !!SILLY[id]; }
  function isFruit(id) { return !!FRUIT[id]; }
  function isNovel(id) { return isSilly(id); } // "novelty" == "silly" (drives the incredulity dialogue)
  function pickCat(rng, av, test) { var p = av.filter(test); return p.length ? pick(rng, p) : null; }
  function recipeIsMeat(name) { return RECIPE[name].toppings.some(isMeat); }
  // Pick n toppings with AT MOST one novelty, so multi-topping orders read like
  // real food (no "marshmallow + beetroot + extra cheese" nonsense piles).
  function pickSensible(rng, av, n) {
    var plain = av.filter(function (id) { return !isNovel(id); });
    if (plain.length >= n) return pickN(rng, plain, n);
    var out = pickN(rng, plain, plain.length);
    var novel = av.filter(isNovel);
    while (out.length < n && novel.length) out.push(novel.splice(Math.floor(rng() * novel.length), 1)[0]);
    return out;
  }

  // ===========================================================================
  // ORDER TEMPLATES (relational, rotation + reflection invariant)
  //
  // A real pizza has no fixed orientation: it can be rotated to any angle and
  // handed across the counter (a flip). So NO order uses absolute anchors
  // ("left", "top-left quarter", "the 1 o'clock slice"). Every reference is
  // RELATIONAL ("one half / the other half", "the quarter across from it", "two
  // slices that aren't touching", "the slice either side of it"), and EVERY
  // order's acceptable set is the full dihedral orbit of its canonical layout
  // (`rotAcc`), so any rotation or flip of a correct build scores 1.0. The
  // teaching target is parsing the relation, not memorising a direction.
  //
  // Canonical layouts are still built on fixed wedge indices for convenience;
  // rotAcc makes the chosen indices irrelevant to grading.
  // ===========================================================================

  function t1_whole(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    return { text: 'A whole pizza on a ' + baseWord(B) + ' base, covered all over in ' + tn(A) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t2_halfHalf(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.right, { addTopping: ab[0] });
    paint(L, REGION.left, { addTopping: ab[1] });
    return { text: baseWord(B) + ' base all over, then one half ' + tn(ab[0]) + ' and the other half ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t4_quarterRest(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION['top-right'], { addTopping: A });
    var restT = restTopping(rng, av, [A]);
    if (restT) {
      [REGION['top-left'], REGION['bottom-left'], REGION['bottom-right']].forEach(function (r) { paint(L, r, { addTopping: restT }); });
      return { text: 'A ' + baseWord(B) + ' base, with ' + tn(A) + ' on just one quarter and ' + tn(restT) + ' on the other three quarters.', acceptable: rotAcc(L), teach: null };
    }
    return { text: 'A ' + baseWord(B) + ' base, with ' + tn(A) + ' on just one quarter. The other three quarters are base only.', acceptable: rotAcc(L), teach: null };
  }
  function t4_threeQuarters(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[0] });
    paint(L, REGION['top-right'], { setToppings: [ab[1]] });
    return { text: baseWord(B) + ' base. Three quarters ' + tn(ab[0]) + ' and just one quarter ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t4_twoQuarters(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION['top-right'], { addTopping: ab[0] });
    paint(L, REGION['bottom-left'], { addTopping: ab[1] }); // the quarter across from it
    var restT = restTopping(rng, av, ab);
    if (restT) {
      paint(L, REGION['top-left'], { addTopping: restT });
      paint(L, REGION['bottom-right'], { addTopping: restT });
      return { text: 'A ' + baseWord(B) + ' base. Put ' + tn(ab[0]) + ' on one quarter and ' + tn(ab[1]) + ' on the quarter straight across from it. The other two quarters get ' + tn(restT) + '.', acceptable: rotAcc(L), teach: null };
    }
    return { text: 'A ' + baseWord(B) + ' base. Put ' + tn(ab[0]) + ' on one quarter and ' + tn(ab[1]) + ' on the quarter straight across from it. The other two quarters are just base.', acceptable: rotAcc(L), teach: null };
  }
  function t5_twoAdjacent(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[1] });
    paint(L, [0, 1], { setToppings: [ab[0]] });
    return { text: baseWord(B) + ' base. Two slices of ' + tn(ab[0]) + ' right next to each other, all the rest ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t5_threeAdjacent(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[1] });
    paint(L, [0, 1, 2], { setToppings: [ab[0]] });
    return { text: baseWord(B) + ' base. Three slices in a row of ' + tn(ab[0]) + ', and all the rest ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t5_oneSlice(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[1] });
    paint(L, [0], { setToppings: [ab[0]] });
    return { text: baseWord(B) + ' base. Just one single slice of ' + tn(ab[0]) + ', and all the rest ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t6_exceptQuarter(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    paint(L, REGION['top-right'], { setToppings: [] });
    return { text: baseWord(B) + ' base, then ' + tn(A) + ' on every slice except one quarter, which stays just base.', acceptable: rotAcc(L), teach: null };
  }
  function t6_oppositeOf(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, [0, 1], { setToppings: [ab[0]] });
    paint(L, [opposite(0), opposite(1)], { setToppings: [ab[1]] });
    return { text: baseWord(B) + ' base. Two slices of ' + tn(ab[0]) + ' next to each other, and the two slices directly across from them get ' + tn(ab[1]) + '. The rest is just base.', acceptable: rotAcc(L), teach: null };
  }
  function t6_diagonalQuarters(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION['top-right'], { addTopping: A });
    paint(L, REGION['bottom-left'], { addTopping: A });
    return { text: baseWord(B) + ' base. Put ' + tn(A) + ' on two quarters that sit straight across from each other, and leave the other two as just base.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Two bases + relational halves ----
  function t7_twoBases(rng, av, un) {
    if (!un || un.indexOf('cheese-base') === -1) return null;
    var A = pick(rng, av);
    var L = emptyLayout();
    paint(L, REGION.right, { base: 'cheese' });
    paint(L, REGION.left, { base: 'tomato' });
    paint(L, REGION.whole, { addTopping: A });
    return { text: 'A cheese base on one half and a tomato base on the other half, then ' + tn(A) + ' all over the top.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Four-person "share" orders: 4 quarters, two want plain cheese and two
  // want a topping each. The 12 quarter-arrangements are all accepted, so the
  // pizza can be rotated/handed over freely; only the WORDS vary.
  var SHARE_FAMILIES = [
    { who: 'me, my wife and our two kids', c: 'Both kids', a: 'I like', b: 'my wife likes' },
    { who: 'me, my husband and the twins', c: 'The twins both', a: 'I want', b: 'my husband wants' },
    { who: 'my little brother, my little sister, Mum and me', c: 'My brother and sister both', a: 'Mum likes', b: 'I like' },
    { who: 'Grandma, Grandpa, my sister and me', c: 'Grandma and Grandpa both', a: 'my sister wants', b: 'I want' },
    { who: 'my two best friends, my dog and me', c: 'My friends both', a: 'my dog (don’t ask) likes', b: 'I like' },
    { who: 'Dad, my big sister, my baby brother and me', c: 'My big sister and the baby both', a: 'Dad wants', b: 'I want' },
    { who: 'the four of us on the football team', c: 'Two of us just', a: 'our captain likes', b: 'I like' },
    { who: 'my uncle, my auntie, my cousin and me', c: 'My uncle and auntie both', a: 'my cousin wants', b: 'I want' },
    { who: 'me, my robot, my cat and my goldfish', c: 'The robot and the cat both', a: 'my goldfish fancies', b: 'I fancy' },
    { who: 'the four wizards in my book club', c: 'Two of the wizards just', a: 'the head wizard likes', b: 'I like' }
  ];
  function t7_share(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2);
    var fam = pick(rng, SHARE_FAMILIES);
    var cells = ['cheese', 'cheese', ab[0], ab[1]];
    var qIdx = [REGION['top-right'], REGION['bottom-right'], REGION['bottom-left'], REGION['top-left']];
    var acceptable = permutations(cells).map(function (perm) {
      var L = emptyLayout();
      perm.forEach(function (cell, i) {
        if (cell === 'cheese') paint(L, qIdx[i], { base: 'cheese' });
        else paint(L, qIdx[i], { base: 'tomato', addTopping: cell });
      });
      return L;
    });
    var text = 'A pizza for ' + fam.who + '. ' + fam.c + ' want plain cheese (cheese base only). ' +
      'On a tomato base, ' + fam.a + ' ' + tn(ab[0]) + ' and ' + fam.b + ' ' + tn(ab[1]) + '. One quarter each!';
    return { text: text, acceptable: acceptable, teach: null };
  }
  function t7_negationBase(rng, av, un) {
    var A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese', addTopping: A });
    paint(L, REGION['top-right'], { setToppings: [] });
    return { text: 'A cheese base on everything, then ' + tn(A) + ' on all of it except for any one quarter, which you leave as just cheese.', acceptable: rotAcc(L), teach: null };
  }
  function t7_alternating(rng, av, un) {
    var A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    [0, 2, 4, 6].forEach(function (i) { paint(L, [i], { addTopping: A }); });
    return { text: 'A cheese base all over, then ' + tn(A) + ' on every other slice, all the way around.', acceptable: rotAcc(L), teach: null };
  }
  function t7_wildcard(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.right, { addTopping: A });
    REGION.left.forEach(function (i) { L[i] = { wildcard: true, nonBare: true, surpriseAgainst: [A] }; });
    return { text: baseWord(B) + ' base with ' + tn(A) + ' on one half, and on the other half, surprise me with a topping of YOUR choice (anything except more ' + tn(A) + ', and don’t leave it bare)!', acceptable: rotAcc(L), teach: null };
  }
  function t7_selfCorrect(rng, av, un) {
    var B = pickBase(rng, un), A = pick(rng, av);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    paint(L, REGION['top-right'], { setToppings: [] });
    return { text: tn(A) + ' on one half. Actually, scrap that, make the WHOLE thing ' + tn(A) + ' on a ' + baseWord(B) + ' base, but keep any one quarter as just the base.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Combo (named-recipe) + multi-topping templates -----------------------
  // Scaffold-then-fade: first appearance states the recipe's base + toppings;
  // once taught (its name is in `taught`) it is named bare.
  function knownRecipe(name, taught) { return !!(taught && taught.indexOf(name) !== -1); }

  function t_comboWhole(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (!pool.length) return null;
    var name = pick(rng, pool);
    var L = paintRecipe(emptyLayout(), REGION.whole, name);
    var known = knownRecipe(name, taught);
    var text = known
      ? 'A whole ' + name + ', please!'
      : 'Make me a whole ' + name + ' pizza. (A ' + name + ' is ' + recipeDescribe(name) + ', the same on every slice.)';
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }
  function t_comboHalves(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (pool.length < 2) return null;
    var two = pickN(rng, pool, 2);
    var L = emptyLayout();
    paintRecipe(L, REGION.right, two[0]);
    paintRecipe(L, REGION.left, two[1]);
    var names = untaught(two, taught);
    var text = 'One half a ' + two[0] + ', the other half a ' + two[1] + '.' + recipeReminder(two);
    return { text: text, acceptable: rotAcc(L), teach: names.length ? { type: 'recipe', names: names } : null };
  }
  function t_comboQuarter(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (!pool.length) return null;
    var name = pick(rng, pool);
    var B = RECIPE[name].base;
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paintRecipe(L, REGION['top-right'], name);
    var known = knownRecipe(name, taught);
    var nameText = known ? 'a ' + name : 'a ' + name + ' (' + recipeDescribe(name) + ')';
    var restT = restTopping(rng, av, RECIPE[name].toppings);
    if (restT) {
      [REGION['top-left'], REGION['bottom-left'], REGION['bottom-right']].forEach(function (r) { paint(L, r, { addTopping: restT }); });
      var t2 = 'Put ' + nameText + ' on just one quarter, and ' + tn(restT) + ' on the other three quarters of the ' + baseWord(B) + ' base.';
      return { text: t2, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
    }
    var text = 'Put ' + nameText + ' on just one quarter, and leave the other three quarters as a ' + baseWord(B) + ' base on its own.';
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }

  // ---- Multi-topping (more than one topping on the same slice) ----
  function t_doubleWhole(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.whole, { addTopping: ab[0] });
    paint(L, REGION.whole, { addTopping: ab[1] });
    return { text: 'A ' + baseWord(B) + ' base, then cover the whole pizza in BOTH ' + tn(ab[0]) + ' and ' + tn(ab[1]) + ' together.', acceptable: rotAcc(L), teach: null };
  }
  function t_doubleHalf(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.right, { addTopping: t[0] });
    paint(L, REGION.right, { addTopping: t[1] });
    paint(L, REGION.left, { addTopping: t[2] });
    return { text: baseWord(B) + ' base everywhere. One half gets ' + tn(t[0]) + ' AND ' + tn(t[1]) + ' on top of each other, and the other half just gets ' + tn(t[2]) + '.', acceptable: rotAcc(L), teach: null };
  }
  // THREE toppings stacked on the slices of one half; a single topping on the other.
  function t_tripleHalf(rng, av, un) {
    if (av.length < 4) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 4);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    [t[0], t[1], t[2]].forEach(function (x) { paint(L, REGION.right, { addTopping: x }); });
    paint(L, REGION.left, { addTopping: t[3] });
    return { text: baseWord(B) + ' base. Pile ALL THREE of ' + tn(t[0]) + ', ' + tn(t[1]) + ' and ' + tn(t[2]) + ' onto one half (all three on every slice of that half), and just ' + tn(t[3]) + ' on the other half.', acceptable: rotAcc(L), teach: null };
  }
  // Category constraint: a meat and a veggie placed so they NEVER touch (another
  // way to say "across from each other"). Teaches the meat/veggie group words.
  function t_catSeparate(rng, av, un) {
    var m = pickCat(rng, av, isMeat), v = pickCat(rng, av, isVeg);
    if (!m || !v) return null;
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paint(L, [0, 1], { setToppings: [m] });
    paint(L, [opposite(0), opposite(1)], { setToppings: [v] }); // straight across, base in between
    return { text: 'A cheese base. Put ' + tn(m) + ' (that is the meat) on two slices next to each other, and ' + tn(v) + ' (the veggie) on the two slices straight across from them. The veggie must NEVER touch the meat, so the slices in between stay plain cheese.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Relational inference / negation / nesting ----
  function t7_nestedException(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.right, { addTopping: ab[0] }); // a 4-in-a-row block
    paint(L, REGION.whole, { base: B });
    paint(L, REGION.right, { setToppings: [ab[0]] });
    paint(L, [0], { setToppings: [ab[1]] }); // one END slice of the block
    return { text: baseWord(B) + ' base. Make a block of four slices in a row all ' + tn(ab[0]) + ', except the slice at one END of that block, which gets ' + tn(ab[1]) + ' instead. The other four slices stay just base.', acceptable: rotAcc(L), teach: null };
  }
  function t7_ordinalRun(rng, av, un) {
    if (av.length < 2) return null;
    var B = pickBase(rng, un), ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, [0, 1, 2], { addTopping: ab[0] });
    paint(L, [3, 4, 5], { addTopping: ab[1] });
    return { text: baseWord(B) + ' base. Starting from any slice and going round: the first three get ' + tn(ab[0]) + ', the next three get ' + tn(ab[1]) + ', and the last two stay as just base.', acceptable: rotAcc(L), teach: null };
  }
  function t7_namedDiagonal(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paint(L, REGION['top-right'], { addTopping: ab[0] });
    paint(L, REGION['bottom-left'], { addTopping: ab[0] });
    paint(L, REGION['top-left'], { addTopping: ab[1] });
    paint(L, REGION['bottom-right'], { addTopping: ab[1] });
    return { text: 'A cheese base everywhere. Two quarters straight across from each other get ' + tn(ab[0]) + '; the other two quarters get ' + tn(ab[1]) + '.', acceptable: rotAcc(L), teach: null };
  }
  // Constraint satisfaction: any two NON-adjacent slices. Acceptable = every
  // non-touching pair (rotation/reflection invariant by construction).
  function t7_constraint(rng, av, un) {
    var A = pick(rng, av);
    var acceptable = [];
    for (var i = 0; i < 8; i++) {
      for (var j = i + 1; j < 8; j++) {
        var d = j - i, circ = Math.min(d, 8 - d);
        if (circ < 2) continue; // touching -> not allowed
        var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
        paint(L, [i, j], { addTopping: A });
        acceptable.push(L);
      }
    }
    return { text: 'A cheese base on everything. Pick exactly two slices that are NOT touching each other and put ' + tn(A) + ' on those two. Everything else stays just cheese base.', acceptable: acceptable, teach: null };
  }
  // Layer conditional: a 4-in-a-row block; its two END slices also get a 2nd topping.
  function t7_layerConditional(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paint(L, REGION.right, { addTopping: ab[0] }); // 4 in a row
    paint(L, [0, 3], { addTopping: ab[1] }); // the two ends of the block
    return { text: 'A cheese base on the whole pizza. Put ' + tn(ab[0]) + ' on four slices in a row. Then, on the two slices at the very ENDS of that block, add ' + tn(ab[1]) + ' on top as well.', acceptable: rotAcc(L), teach: null };
  }
  // In-order distractor: a red-herring clause names a topping that must NOT be placed.
  function t7_inOrderDistractor(rng, av, un) {
    if (av.length < 3) return null;
    var t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paint(L, REGION.right, { addTopping: t[0] });
    paint(L, REGION.left, { addTopping: t[1] });
    return { text: 'My brother is allergic to ' + tn(t[2]) + ' and my dog hates loud noises, so listen carefully: ' + tn(t[0]) + ' on one half and ' + tn(t[1]) + ' on the other half, cheese base under all of it.', acceptable: rotAcc(L), teach: null };
  }
  // Three-way split: one half all X; the other half's two quarters get Y and Z.
  function t_threeRegion(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.left, { addTopping: t[0] });
    paint(L, REGION['top-right'], { addTopping: t[1] });
    paint(L, REGION['bottom-right'], { addTopping: t[2] });
    return { text: baseWord(B) + ' base. One whole half is all ' + tn(t[0]) + '. The other half is split into its two quarters: one gets ' + tn(t[1]) + ', the other gets ' + tn(t[2]) + '.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Compound / composite top tiers (all relational) ----
  // Four different toppings, one per quarter, named by going AROUND.
  function t8_fourQuarters(rng, av, un) {
    if (av.length < 4) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 4);
    var qs = [REGION['top-right'], REGION['bottom-right'], REGION['bottom-left'], REGION['top-left']];
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    qs.forEach(function (r, k) { paint(L, r, { addTopping: t[k] }); });
    return { text: baseWord(B) + ' base, every quarter different. Going around the four quarters in order: ' + tn(t[0]) + ', then ' + tn(t[1]) + ', then ' + tn(t[2]) + ', then ' + tn(t[3]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t9_quarterRecipes(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (pool.length < 4) return null;
    var r4 = pickN(rng, pool, 4);
    var qs = [REGION['top-right'], REGION['bottom-right'], REGION['bottom-left'], REGION['top-left']];
    var L = emptyLayout();
    r4.forEach(function (nm, k) { paintRecipe(L, qs[k], nm); });
    var names = untaught(r4, taught);
    var text = 'Four quarters, four little pizzas in one! Going around in order: a ' + r4[0] + ', then a ' + r4[1] + ', then a ' + r4[2] + ', then a ' + r4[3] + '.' + recipeReminder(r4);
    return { text: text, acceptable: rotAcc(L), teach: names.length ? { type: 'recipe', names: names } : null };
  }
  // Relational per-slice: one slice changed, the slice across changed, the two
  // slices either side of it stacked with a second topping.
  function t10_perSlice(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: t[2] });
    paint(L, [0], { setToppings: [t[0]] });
    paint(L, [4], { setToppings: [t[1]] }); // straight across
    paint(L, [1], { setToppings: [t[2], t[0]] }); // either side of the t0 slice
    paint(L, [7], { setToppings: [t[2], t[0]] });
    return { text: baseWord(B) + ' base with ' + tn(t[2]) + ' on every slice. Then: pick any one slice and make it just ' + tn(t[0]) + '. The slice straight across from it becomes just ' + tn(t[1]) + '. And the two slices either side of your ' + tn(t[0]) + ' slice get ' + tn(t[0]) + ' added on top of their ' + tn(t[2]) + '.', acceptable: rotAcc(L), teach: null };
  }
  function t11_compound(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (!pool.length || av.length < 1) return null;
    var name = pick(rng, pool), A = pick(rng, av);
    var L = emptyLayout();
    paintRecipe(L, REGION.left, name);
    paint(L, REGION.right, { base: RECIPE[name].base });
    paint(L, [0, 2], { addTopping: A });
    var known = knownRecipe(name, taught);
    var text = 'One half is a ' + name + (known ? '' : ' (' + recipeDescribe(name) + ')') + '. The other half has the same base, with ' + tn(A) + ' on every other slice.';
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }
  // A full going-around sequence: a repeating 3-topping pattern, one per slice.
  function t20_clockSequence(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 3);
    var seq = [t[0], t[1], t[2], t[0], t[1], t[2], t[0], t[1]];
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    for (var i = 0; i < 8; i++) paint(L, [i], { setToppings: [seq[i]] });
    return { text: baseWord(B) + ' base. Starting from any slice and going all the way around, one topping per slice: ' + seq.map(tn).join(', then ') + '.', acceptable: rotAcc(L), teach: null };
  }
  // Two recipes on the halves, then one quarter of the second recipe's half is
  // overridden to plain cheese (a coherent "the baby only eats cheese" exception).
  function t20_recipeHalvesException(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (pool.length < 2) return null;
    var two = pickN(rng, pool, 2);
    var L = emptyLayout();
    paintRecipe(L, REGION.left, two[0]);
    paintRecipe(L, REGION.right, two[1]);
    paint(L, REGION['top-right'], { base: 'cheese', setToppings: [] }); // one quarter -> plain cheese
    var names = untaught(two, taught);
    var text = 'One half is a ' + two[0] + ', the other half a ' + two[1] + '. But the baby only eats plain cheese, so one quarter of the ' + two[1] + ' half is just a cheese base on its own.' + recipeReminder(two);
    return { text: text, acceptable: rotAcc(L), teach: names.length ? { type: 'recipe', names: names } : null };
  }
  // Negation + the quarter across also gets a second topping stacked.
  function t20_negateAndPlace(rng, av, un) {
    if (av.length < 3) return null;
    var t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese', addTopping: t[0] });
    paint(L, REGION['top-right'], { setToppings: [t[1]] }); // one quarter -> t1 instead
    paint(L, REGION['bottom-left'], { addTopping: t[2] }); // quarter across -> t0 + t2
    return { text: 'Cheese base. ' + cap(tn(t[0])) + ' on every slice EXCEPT one quarter, which gets ' + tn(t[1]) + ' instead. Then the quarter directly across from that one ALSO gets ' + tn(t[2]) + ' added on top of its ' + tn(t[0]) + '.', acceptable: rotAcc(L), teach: null };
  }
  // Build up, REMOVE from one half (negation by revision), add to the other half,
  // then a single-slice placement on the bared half.
  function t20_buildRemovePlace(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un), t = pickSensible(rng, av, 3);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: t[0] });
    paint(L, REGION.left, { setToppings: [] }); // take it off one half
    paint(L, REGION.right, { addTopping: t[1] }); // add to the other half
    paint(L, [4], { setToppings: [t[2]] }); // one slice of the bared half
    return { text: baseWord(B) + ' base with ' + tn(t[0]) + ' over the WHOLE pizza. Now take the ' + tn(t[0]) + ' back OFF one half. Add ' + tn(t[1]) + ' to the other half. Finally, put ' + tn(t[2]) + ' on just one single slice of the bare half.', acceptable: rotAcc(L), teach: null };
  }


  // ---- Compositional orders: chain several EARLIER lessons into one multi-
  // sentence order (halves, then a per-half pattern, a single-slice stack, a
  // swap...). Difficulty = how many clauses stack up. Each clause touches a
  // DISJOINT set of slices so they never conflict, and the whole thing grades
  // by the dihedral orbit of the final layout.
  function compositeBuild(rng, av, un, clauses) {
    var t = pickSensible(rng, av, 6);
    if (t.length < 6) return null;
    var B = pickBase(rng, un), A = t[0], C = t[1];
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.right, { addTopping: A });  // {0,1,2,3}
    paint(L, REGION.left, { addTopping: C });   // {4,5,6,7}
    var nameA = 'the ' + tn(A) + ' half', nameC = 'the ' + tn(C) + ' half';
    var sents = [baseWord(B) + ' base everywhere. One half is all ' + tn(A) + ', the other half all ' + tn(C) + '.'];
    var mods = [
      function () { paint(L, [0], { setToppings: [A, t[2]] }); return 'One single slice of ' + nameA + ' gets ' + tn(t[2]) + ' piled on top as well.'; },
      function () { paint(L, [4, 6], { addTopping: t[3] }); return 'On ' + nameC + ', add ' + tn(t[3]) + ' to every other slice.'; },
      function () { paint(L, [2], { setToppings: [t[4]] }); return 'One of the other slices on ' + nameA + ' is ' + tn(t[4]) + ' instead.'; },
      function () { paint(L, [5], { setToppings: [t[5]] }); return 'And one single slice of ' + nameC + ' is just ' + tn(t[5]) + ' on its own.'; }
    ];
    for (var i = 0; i < Math.min(clauses, mods.length); i++) sents.push(mods[i]());
    return { text: sents.join(' '), acceptable: rotAcc(L), teach: null };
  }
  function t_composite3(rng, av, un) { return compositeBuild(rng, av, un, 3); }
  function t_composite4(rng, av, un) { return compositeBuild(rng, av, un, 4); }

  // Coherent dietary share: the two veggie recipes go on quarters across from
  // each other, the two meat recipes on the quarters across from each other (a
  // diagonal arrangement). NOTE: four filled quarters always touch at their
  // GENUINE non-touch: each recipe goes on a 3-in-a-row block, with the two
  // slices between the blocks left plain as a buffer, so veg never touches meat.
  // (You don't have to fill all 8 slices: the gaps are what keep them apart.)
  function t_dietaryShare(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    var meats = pool.filter(recipeIsMeat), vegs = pool.filter(function (n) { return !recipeIsMeat(n); });
    if (!meats.length || !vegs.length) return null;
    var m = pick(rng, meats), v = pick(rng, vegs);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paintRecipe(L, [1, 2, 3], m); // meat: three in a row
    paintRecipe(L, [5, 6, 7], v); // veg: three in a row, across; slices 0 and 4 are the cheese buffer
    var text = 'A family pizza, and the veggies must NEVER touch the meat. Put a ' + m + ' on three slices in a row, and a ' + v + ' on three slices in a row across from it. The one slice between each group stays just a plain CHEESE base, as a gap so nothing touches.' + recipeReminder([m, v]);
    var names = untaught([m, v], taught);
    return { text: text, acceptable: rotAcc(L), teach: names.length ? { type: 'recipe', names: names } : null };
  }

  // ---- Recipe transforms: recall a recipe, then apply a delta (remove / swap).
  // Pure build-time edits, so a normal fixed layout grades them. Scaffolded with
  // the recipe definition until the recipe is taught.
  function t_recipeRemove(rng, av, un, taught) {
    var pool = buildableRecipes(un).filter(function (n) { return RECIPE[n].toppings.length >= 2; });
    if (!pool.length) return null;
    var name = pick(rng, pool), r = RECIPE[name], drop = pick(rng, r.toppings);
    var kept = r.toppings.filter(function (t) { return t !== drop; });
    var L = paint(emptyLayout(), REGION.whole, { base: r.base, setToppings: kept });
    var known = knownRecipe(name, taught);
    var text = 'A whole ' + name + ' pizza, but hold the ' + tn(drop) + ', leave it off completely.' + (known ? '' : ' (A ' + name + ' is ' + recipeDescribe(name) + '.)');
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }
  function t_recipeSwap(rng, av, un, taught) {
    var pool = buildableRecipes(un).filter(function (n) { return RECIPE[n].toppings.length >= 1; });
    if (!pool.length) return null;
    var name = pick(rng, pool), r = RECIPE[name], out = pick(rng, r.toppings);
    var avIn = av.filter(function (t) { return r.toppings.indexOf(t) === -1; });
    if (!avIn.length) return null;
    var into = pickSensible(rng, avIn, 1)[0];
    var newTops = r.toppings.filter(function (t) { return t !== out; }).concat([into]);
    var L = paint(emptyLayout(), REGION.whole, { base: r.base, setToppings: newTops });
    var known = knownRecipe(name, taught);
    var text = 'A whole ' + name + ', but swap the ' + tn(out) + ' for ' + tn(into) + ' instead.' + (known ? '' : ' (A ' + name + ' is ' + recipeDescribe(name) + '.)');
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }
  function t_recipeHalfMinus(rng, av, un, taught) {
    var pool = buildableRecipes(un).filter(function (n) { return RECIPE[n].toppings.length >= 2; });
    if (!pool.length) return null;
    var name = pick(rng, pool), r = RECIPE[name], drop = pick(rng, r.toppings);
    var L = emptyLayout();
    paintRecipe(L, REGION.left, name);
    paint(L, REGION.right, { base: r.base, setToppings: r.toppings.filter(function (t) { return t !== drop; }) });
    var known = knownRecipe(name, taught);
    var text = 'One half a full ' + name + '. The other half is the same ' + name + ', except on that half hold the ' + tn(drop) + '.' + (known ? '' : ' (A ' + name + ' is ' + recipeDescribe(name) + '.)');
    return { text: text, acceptable: rotAcc(L), teach: known ? null : { type: 'recipe', names: [name] } };
  }

  // Four-way share where NOBODY's topping touches: one slice each, every other
  // slice, with a cheese-only slice as a gap between every one of them.
  function t_gapShare(rng, av, un) {
    if (av.length < 4) return null;
    var t = pickSensible(rng, av, 4);
    var L = paint(emptyLayout(), REGION.whole, { base: 'cheese' });
    paint(L, [0], { setToppings: [t[0]] });
    paint(L, [2], { setToppings: [t[1]] });
    paint(L, [4], { setToppings: [t[2]] });
    paint(L, [6], { setToppings: [t[3]] }); // {1,3,5,7} stay cheese-only gaps
    return { text: 'A pizza for four, and nobody wants their topping touching anyone else’s! On a cheese base, go around giving every OTHER slice one person’s topping, in order: ' + tn(t[0]) + ', then ' + tn(t[1]) + ', then ' + tn(t[2]) + ', then ' + tn(t[3]) + '. Between each one, leave a plain cheese slice as a gap so none of them touch.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Base tricks: orders that use the three bases as part of the puzzle, and
  // CONDITIONAL placement ("put X only on the cheese-base slices").
  // Two-base conditional: lay two bases, then place a topping conditioned on base.
  function t_twoBaseConditional(rng, av, un) {
    if (un.indexOf('cheese-base') === -1 || av.length < 2) return null;
    var ab = pickSensible(rng, av, 2);
    var L = emptyLayout();
    paint(L, REGION.right, { base: 'cheese' });
    paint(L, REGION.left, { base: 'tomato' });
    paint(L, REGION.right, { addTopping: ab[0] });
    paint(L, REGION.left, { addTopping: ab[1] });
    return { text: 'Give one half a cheese base and the other half a tomato base. Now the tricky bit: put ' + tn(ab[0]) + ' ONLY on the cheese-base slices, and ' + tn(ab[1]) + ' ONLY on the tomato-base slices.', acceptable: rotAcc(L), teach: null };
  }
  // Three different bases across three regions.
  function t_threeBases(rng, av, un) {
    if (un.indexOf('cheese-base') === -1 || un.indexOf('bbq-base') === -1) return null;
    var A = pick(rng, av);
    var L = emptyLayout();
    paint(L, REGION.left, { base: 'tomato' });
    paint(L, REGION['top-right'], { base: 'cheese' });
    paint(L, REGION['bottom-right'], { base: 'bbq' });
    paint(L, REGION.whole, { addTopping: A });
    return { text: 'Three different bases! One whole half gets a tomato base. Of the other two quarters, one gets a cheese base and the other a BBQ base. Then ' + tn(A) + ' all over the top.', acceptable: rotAcc(L), teach: null };
  }
  // Three bases, each with its OWN topping (a sampler) -> base-conditional reading.
  function t_threeBaseConditional(rng, av, un) {
    if (un.indexOf('cheese-base') === -1 || un.indexOf('bbq-base') === -1 || av.length < 3) return null;
    var t = pickSensible(rng, av, 3);
    var L = emptyLayout();
    paint(L, REGION.left, { base: 'tomato', addTopping: t[0] });
    paint(L, REGION['top-right'], { base: 'cheese', addTopping: t[1] });
    paint(L, REGION['bottom-right'], { base: 'bbq', addTopping: t[2] });
    return { text: 'A three-base sampler. One whole half is a tomato base, and the only topping on the tomato is ' + tn(t[0]) + '. Of the other two quarters, the cheese-base one gets only ' + tn(t[1]) + ', and the BBQ-base one gets only ' + tn(t[2]) + '.', acceptable: rotAcc(L), teach: null };
  }

  // ---- Category-count: "any N different meats / vegetables per slice". The
  // player chooses which toppings; the grader only checks count + category.
  // Colour groups, for "shared property" orders ("put a GREEN topping on every
  // slice"). Membership is by the topping's real colour, a property the child can
  // see, independent of the food categories above.
  var GREEN = { pepper: 1, spinach: 1, broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1 };
  var RED = { pepperoni: 1, 'tomato-slice': 1, chilli: 1 };
  function isFruitSilly(id) { return isFruit(id) && isSilly(id); }      // banana, raisins
  function isPureSilly(id) { return isSilly(id) && !isVeg(id) && !isFruit(id); } // marshmallow, fish-heads
  function catTest(cat) {
    return cat === 'meat' ? isMeat : (cat === 'veg' ? isVeg : (cat === 'silly' ? isSilly :
      (cat === 'fruit' ? isFruit : (cat === 'fruitsilly' ? isFruitSilly : (cat === 'puresilly' ? isPureSilly :
        (cat === 'green' ? function (id) { return !!GREEN[id]; } : (cat === 'red' ? function (id) { return !!RED[id]; } :
          (cat === 'any' ? function () { return true; } : function () { return false; }))))))));
  }
  // plural noun for a category, used in order text and the mistakes report.
  function catWord(cat) {
    return cat === 'meat' ? 'meats' : (cat === 'veg' ? 'vegetables' : (cat === 'silly' ? 'silly toppings' :
      (cat === 'fruit' ? 'fruits' : (cat === 'fruitsilly' ? 'fruity silly toppings' : (cat === 'puresilly' ? 'silly-only toppings' :
        (cat === 'green' ? 'green toppings' : (cat === 'red' ? 'red toppings' : 'toppings')))))));
  }
  var NUMWORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'];
  function numWord(n) { return NUMWORD[n] != null ? NUMWORD[n] : ('' + n); }
  function t_catCountWhole(rng, av, un) {
    // only offer a category that actually has >= 3 unlocked (so a "silly pizza"
    // can't be asked for when no silly ingredients exist).
    var cats = ['meat', 'veg', 'silly', 'fruit'].filter(function (c) { return av.filter(catTest(c)).length >= 3; });
    if (!cats.length) return null;
    var cat = pick(rng, cats);
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: cat, count: 3 });
    return { text: 'A ' + baseWord(B) + ' base. Then put any 3 different ' + catWord(cat).toUpperCase() + ' on every single slice. You choose which 3!', acceptable: [L], teach: null };
  }
  // Count comparisons: "MORE THAN two meats" / "FEWER THAN five toppings" on every
  // slice. Uses the catCount range (min/max). The player picks which toppings.
  function t_countCompare(rng, av, un) {
    var cats = ['any', 'meat', 'veg', 'fruit', 'silly'].filter(function (c) {
      return (c === 'any' ? av.length : av.filter(catTest(c)).length) >= 3;
    });
    var opts = [];
    cats.forEach(function (c) {
      var avail = c === 'any' ? av.length : av.filter(catTest(c)).length;
      [2, 3].forEach(function (n) { if (avail >= n + 1) opts.push({ c: c, kind: 'more', n: n, min: n + 1, max: avail }); });
      [4, 5].forEach(function (m) { if (m - 1 >= 1 && avail >= 1) opts.push({ c: c, kind: 'less', m: m, min: 1, max: Math.min(m - 1, avail) }); });
    });
    if (!opts.length) return null;
    var o = pick(rng, opts);
    var B = pickBase(rng, un);
    var word = catWord(o.c).toUpperCase();
    var phrase, text;
    if (o.kind === 'more') {
      phrase = 'more than ' + numWord(o.n) + ' ' + catWord(o.c);
      text = 'A ' + baseWord(B) + ' base. On every single slice, put MORE THAN ' + numWord(o.n).toUpperCase() + ' different ' + word + '. You pick which ones!';
    } else {
      phrase = 'fewer than ' + numWord(o.m) + ' ' + catWord(o.c) + ' (at least one)';
      text = 'A ' + baseWord(B) + ' base. On every single slice, put FEWER THAN ' + numWord(o.m).toUpperCase() + ' different ' + word + ', but at least one! You pick which ones!';
    }
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: o.c, min: o.min, max: o.max, phrase: phrase });
    return { text: text, acceptable: [L], teach: null };
  }
  // The "silly pizza": every slice gets exactly one silly topping (kid's choice).
  function t_sillyEvery(rng, av, un) {
    if (av.filter(isSilly).length < 1) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: 'silly', count: 1 });
    return { text: 'A ' + baseWord(B) + ' base, and make it SILLY! Every single slice gets exactly ONE silly topping. You pick which silly one for each slice, and they can all be different!', acceptable: [L], teach: null };
  }
  // "Any fruit" pizza: every slice gets exactly one fruit (kid's choice). Only 3
  // fruits exist, so this needs just >= 1 unlocked and reads as "pick any fruit".
  function t_fruitEvery(rng, av, un) {
    if (av.filter(isFruit).length < 1) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: 'fruit', count: 1 });
    return { text: 'A ' + baseWord(B) + ' base, then a FRUITY pizza! Every single slice gets exactly ONE fruit. You pick any fruit you like for each slice, and they can all be different!', acceptable: [L], teach: null };
  }
  function t_catCountHalves(rng, av, un) {
    if (av.filter(isMeat).length < 3 || av.filter(isVeg).length < 3) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push(makeSlice(B, []));
    REGION.right.forEach(function (i) { L[i] = { catCount: true, base: B, cat: 'meat', count: 3 }; });
    REGION.left.forEach(function (i) { L[i] = { catCount: true, base: B, cat: 'veg', count: 3 }; });
    return { text: 'A ' + baseWord(B) + ' base. On one half, pile any 3 different MEATS onto every slice. On the other half, any 3 different VEGETABLES on every slice. Your pick which ones!', acceptable: rotAcc(L), teach: null };
  }

  // ===========================================================================
  // Language-construct templates. Each resolves to an EXISTING layout/grader
  // shape (fixed, multi-acceptable, or catCount); the teaching is in the English.
  // Markers in CAPS / fixed phrases let the tests detect each construct.
  // ===========================================================================

  // Riddle: name the topping by a clue, not its word. Reading + inference.
  var RIDDLE = {
    pepperoni: 'a round red circle of spicy meat', mushroom: 'a little pale umbrella shape',
    pineapple: 'a sweet, spiky yellow fruit', olive: 'a tiny black ring',
    banana: 'a soft yellow fruit you peel', sweetcorn: 'a tiny yellow kernel of corn',
    chilli: 'a small red pepper that is super spicy', broccoli: 'a little green tree you can eat'
  };
  function t_riddle(rng, av, un) {
    var pool = av.filter(function (id) { return RIDDLE[id]; });
    if (!pool.length) return null;
    var A = pick(rng, pool), B = pickBase(rng, un);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    return { text: 'Guess the topping! It is ' + RIDDLE[A] + '. Put that topping all over a ' + baseWord(B) + ' base.', acceptable: rotAcc(L), teach: null, concept: 'whole' };
  }

  // Pronoun carry-over: the second sentence says "it" for the topping just named.
  function t_pronoun(rng, av, un) {
    if (!av.length) return null;
    var A = pick(rng, av), B = pickBase(rng, un);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    return { text: 'Put ' + tn(A) + ' on one half of a ' + baseWord(B) + ' base. Now put it on the other half too, so it ends up everywhere.', acceptable: rotAcc(L), teach: null, concept: 'whole' };
  }

  // "The other one": two toppings, assigned by "the first one / the other one".
  function t_theOther(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2), B = pickBase(rng, un);
    var L = paint(emptyLayout(), REGION.whole, { base: B });
    paint(L, REGION.right, { addTopping: ab[0] });
    paint(L, REGION.left, { addTopping: ab[1] });
    return { text: 'Grab ' + tn(ab[0]) + ' and ' + tn(ab[1] ) + '. On a ' + baseWord(B) + ' base, the first one goes on one half, and the other one goes on the other half.', acceptable: rotAcc(L), teach: null, concept: 'half' };
  }

  // Conditional with a stated (always true) fact: the child evaluates it to true
  // and does the THEN branch. The category claim is genuinely correct.
  function t_conditionTrue(rng, av, un) {
    var pool = av.filter(function (id) { return isMeat(id) || isVeg(id) || isFruit(id); });
    if (!pool.length) return null;
    var A = pick(rng, pool), B = pickBase(rng, un);
    var word = isMeat(A) ? 'a meat' : (isFruit(A) ? 'a fruit' : 'a vegetable');
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    return { text: 'Is ' + tn(A) + ' ' + word + '? Yes, it is! So, because that is true, cover the whole ' + baseWord(B) + ' base in ' + tn(A) + '.', acceptable: rotAcc(L), teach: null, concept: 'whole' };
  }

  // Deduction by elimination: not a meat, not a fruit, not a vegetable -> a
  // silly-only topping (marshmallow / fish heads).
  function t_elimination(rng, av, un) {
    if (av.filter(isPureSilly).length < 1) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: 'puresilly', count: 1, phrase: 'one silly topping that is not a meat, vegetable or fruit' });
    return { text: 'Mystery topping on a ' + baseWord(B) + ' base! It is NOT a meat, NOT a vegetable and NOT a fruit. Work out what kind is left, and put one of those silly toppings on every single slice.', acceptable: [L], teach: null, concept: 'catCount' };
  }

  // Either/or: one region, two named toppings, pick exactly one to use.
  function t_eitherOr(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2), B = pickBase(rng, un);
    var La = paint(emptyLayout(), REGION.whole, { base: B }); paint(La, REGION.top, { addTopping: ab[0] });
    var Lb = paint(emptyLayout(), REGION.whole, { base: B }); paint(Lb, REGION.top, { addTopping: ab[1] });
    return { text: 'On one half of a ' + baseWord(B) + ' base, put EITHER ' + tn(ab[0]) + ' OR ' + tn(ab[1]) + ' - you choose just one of them. The other half stays plain.', acceptable: rotAcc(La).concat(rotAcc(Lb)), teach: null };
  }

  // Not both: whole pizza in one of two toppings, never a mix.
  function t_notBoth(rng, av, un) {
    if (av.length < 2) return null;
    var ab = pickN(rng, av, 2), B = pickBase(rng, un);
    var La = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[0] });
    var Lb = paint(emptyLayout(), REGION.whole, { base: B, addTopping: ab[1] });
    return { text: 'Cover the whole ' + baseWord(B) + ' base in ' + tn(ab[0]) + ' or ' + tn(ab[1]) + ', but NOT both. Pick one and use only that one, all over.', acceptable: rotAcc(La).concat(rotAcc(Lb)), teach: null };
  }

  // Intersection of categories: a topping that is BOTH a fruit AND silly.
  function t_intersectionCat(rng, av, un) {
    if (av.filter(isFruitSilly).length < 1) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: 'fruitsilly', count: 1, phrase: 'one topping that is both a fruit and silly' });
    return { text: 'On a ' + baseWord(B) + ' base, every single slice gets ONE topping that is BOTH a fruit AND a silly topping at the same time. Which toppings are in both groups?', acceptable: [L], teach: null, concept: 'intersection' };
  }

  // At least one of a category: min 1, no upper limit (player chooses how many).
  function t_atLeastOne(rng, av, un) {
    var cats = ['meat', 'veg', 'fruit', 'silly'].filter(function (c) { return av.filter(catTest(c)).length >= 2; });
    if (!cats.length) return null;
    var cat = pick(rng, cats), B = pickBase(rng, un), hi = av.filter(catTest(cat)).length;
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: cat, min: 1, max: hi, phrase: 'at least one ' + catWord(cat) });
    return { text: 'A ' + baseWord(B) + ' base. On every single slice, put AT LEAST ONE of the ' + catWord(cat).toUpperCase() + ' - one is fine, more is fine, you choose!', acceptable: [L], teach: null, concept: 'catCount' };
  }

  // Dietary inference: "can't eat meat" -> no meat -> a vegetable instead.
  function t_dietary(rng, av, un) {
    if (av.filter(isVeg).length < 1) return null;
    var B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: 'veg', count: 1, phrase: 'one vegetable (no meat)' });
    return { text: 'My little brother CANNOT eat meat. So put NO meat at all on a ' + baseWord(B) + ' base. Give every slice one VEGETABLE instead, so it is safe for him.', acceptable: [L], teach: null, concept: 'catCount' };
  }

  // Shared property (colour): every slice gets a topping of one shared colour.
  function t_sharedProperty(rng, av, un) {
    var cols = [['green', 'green like grass'], ['red', 'red like a tomato']].filter(function (c) { return av.filter(catTest(c[0])).length >= 1; });
    if (!cols.length) return null;
    var c = pick(rng, cols), B = pickBase(rng, un);
    var L = []; for (var i = 0; i < 8; i++) L.push({ catCount: true, base: B, cat: c[0], count: 1, phrase: 'one ' + c[0] + ' topping' });
    return { text: 'A colour pizza on a ' + baseWord(B) + ' base! Every single slice gets ONE topping that is ' + c[0].toUpperCase() + ' (' + c[1] + '). They all share the same colour.', acceptable: [L], teach: null, concept: 'catCount' };
  }

  // Normative keywords (RFC 2119 register): a rules order where each clause's
  // keyword sets the grading strictness.
  //   mandatory  (MUST / SHALL / REQUIRED)        -> topping present in EVERY reading
  //   forbidden  (MUST NOT / SHALL NOT)           -> topping absent in EVERY reading
  //   optional   (MAY / OPTIONAL / SHOULD /        -> player's choice: both the with-
  //               RECOMMENDED / SHOULD NOT)            and without- layouts are accepted
  // a topping clashes with a base when their words would read as the same thing
  // (a "tomato base" must not also talk about a "tomato"/"tomato slice" topping,
  // a "cheese base" not about an "extra cheese" topping). Keeps rule orders clear.
  function baseClash(base) {
    return base === 'tomato' ? ['tomato-slice'] : (base === 'cheese' ? ['extra-cheese'] : []);
  }
  function t_normative(rng, av, un) {
    if (av.length < 3) return null;
    var B = pickBase(rng, un);
    var clash = baseClash(B);
    var pool = av.filter(function (id) { return clash.indexOf(id) === -1; });
    if (pool.length < 3) pool = av; // not enough variety to be picky; fall back
    var t = pickN(rng, pool, 3), A = t[0], C = t[1], D = t[2];
    var mand = pick(rng, ['MUST', 'SHALL', 'REQUIRED']);
    var opt = pick(rng, ['MAY', 'OPTIONAL', 'SHOULD', 'RECOMMENDED', 'SHOULD NOT']);
    var proh = pick(rng, ['MUST NOT', 'SHALL NOT']);
    // required A on one half (both readings); C on the other half is optional
    // (with-C reading + without-C reading); D forbidden (in neither reading).
    var withC = paint(emptyLayout(), REGION.whole, { base: B });
    paint(withC, REGION.right, { addTopping: A }); paint(withC, REGION.left, { addTopping: C });
    var without = paint(emptyLayout(), REGION.whole, { base: B });
    paint(without, REGION.right, { addTopping: A });
    var mandClause = mand === 'REQUIRED' ? (tn(A) + ' is REQUIRED on one half') : ('you ' + mand + ' put ' + tn(A) + ' on one half');
    var optClause = opt === 'OPTIONAL' ? ('adding ' + tn(C) + ' to the other half is OPTIONAL')
      : (opt === 'RECOMMENDED' ? ('adding ' + tn(C) + ' to the other half is RECOMMENDED')
        : ('you ' + opt + ' add ' + tn(C) + ' to the other half'));
    var prohClause = 'you ' + proh + ' use any ' + tn(D);
    optClause = optClause.charAt(0).toUpperCase() + optClause.slice(1); // new sentence after the full stop
    var text = 'Order rules! On a ' + baseWord(B) + ' base: ' + mandClause + '. ' + optClause + '. And ' + prohClause + '.';
    return { text: text, acceptable: rotAcc(withC).concat(rotAcc(without)), teach: null };
  }

  // NOT-in-combination: a positive whole-coverage clause plus a localized
  // negation exception. "Covered in banana, but one slice must NOT have banana."
  // Exactly one slice is left bare; rotAcc accepts whichever slice the child picks.
  function t_notException(rng, av, un) {
    if (!av.length) return null;
    var A = pick(rng, av), B = pickBase(rng, un);
    var L = paint(emptyLayout(), REGION.whole, { base: B, addTopping: A });
    L[0] = makeSlice(B, []); // exactly one slice has NO A on it
    return { text: 'Cover the whole ' + baseWord(B) + ' base in ' + tn(A) + '. But ONE single slice - any one you pick - should NOT have ' + tn(A) + ' on it. Leave that one slice with just the base.', acceptable: rotAcc(L), teach: null, concept: 'except' };
  }

  // Uneven share: one half is the speaker's; the OTHER half is split between two
  // kids unequally - the named child who "eats more" gets 3 slices, the other 1.
  // Combines sharing (a half = 4 slices) with inequality (more than). The single
  // smaller-share slice may sit anywhere in the half, so two canonical internal
  // positions (each via rotAcc) cover all four arrangements.
  var KIDNAMES = ['Sam', 'Joey', 'Mia', 'Leo', 'Ava', 'Max', 'Kit', 'Roo'];
  function t_unevenShare(rng, av, un) {
    if (av.length < 3) return null;
    var t = pickN(rng, av, 3), S = t[0], P = t[1], Q = t[2], B = pickBase(rng, un);
    var names = pickN(rng, KIDNAMES, 2);
    var accs = [];
    [0, 1].forEach(function (pos) { // pos 0 (->0,3 by reflection) and 1 (->1,2) cover all four
      var L = paint(emptyLayout(), REGION.whole, { base: B });
      REGION.left.forEach(function (i) { paint(L, [i], { addTopping: S }); }); // speaker's half
      REGION.right.forEach(function (i) { paint(L, [i], { addTopping: P }); }); // bigger eater
      L[REGION.right[pos]] = makeSlice(B, [Q]);                                 // the one smaller-share slice
      accs = accs.concat(rotAcc(L));
    });
    var text = 'I want one half all ' + tn(S) + ' for me. Give my other half to my two kids: ' + names[0] + ' wants ' + tn(P) + ' and ' + names[1] + ' wants ' + tn(Q) + '. But ' + names[0] + ' will eat MORE than ' + names[1] + ', so ' + names[0] + ' gets 3 slices and ' + names[1] + ' gets just 1.';
    return { text: text, acceptable: accs, teach: null, concept: 'half' };
  }

  // ---- Constructs distilled from the Levels 11-20 OpenAI consult --------------
  // Each is a single, cleanly-gradeable mechanic lifted from the variation set.
  // The dense 4-clause composites from 16-20 are NOT auto-wired: their grading
  // would need bespoke enumerated acceptable-sets, so they stay authoring
  // reference in VARIATIONS-11-20.md. These four are the genuinely-new gradeable
  // ones.

  // Alternating named recipes: every other slice recipe A, the slices between
  // recipe B. Both interleavings accepted (the dihedral orbit covers them).
  function t_altRecipes(rng, av, un, taught) {
    var pool = buildableRecipes(un);
    if (pool.length < 2) return null;
    var two = pickN(rng, pool, 2);
    var L = emptyLayout();
    [0, 2, 4, 6].forEach(function (i) { paintRecipe(L, [i], two[0]); });
    [1, 3, 5, 7].forEach(function (i) { paintRecipe(L, [i], two[1]); });
    var names = untaught(two, taught);
    var text = 'Going all the way around: make every other slice a ' + two[0] +
      ', and each slice between them a ' + two[1] + '.' + recipeReminder(two);
    return { text: text, acceptable: rotAcc(L), teach: names.length ? { type: 'recipe', names: names } : null, concept: 'everyOther' };
  }

  // Checkerboard of two different bases: every other slice base X with topping A,
  // the slices between base Y with topping B. Needs a second base unlocked.
  function availableBases(un) {
    var o = ['tomato'];
    if (un && un.indexOf('cheese-base') !== -1) o.push('cheese');
    if (un && un.indexOf('bbq-base') !== -1) o.push('bbq');
    return o;
  }
  function t_checkerboard(rng, av, un) {
    var bases = availableBases(un);
    if (bases.length < 2 || av.length < 2) return null;
    var two = pickN(rng, bases, 2), B1 = two[0], B2 = two[1];
    var t = pickN(rng, av, 2), A = t[0], C = t[1];
    var L = emptyLayout();
    [0, 2, 4, 6].forEach(function (i) { L[i] = makeSlice(B1, [A]); });
    [1, 3, 5, 7].forEach(function (i) { L[i] = makeSlice(B2, [C]); });
    var text = 'Make it a checkerboard! Every other slice is a ' + baseWord(B1) +
      ' base with ' + tn(A) + ', and each slice between them is a ' + baseWord(B2) +
      ' base with ' + tn(C) + '. All the way around.';
    return { text: text, acceptable: rotAcc(L), teach: null, concept: 'everyOther' };
  }

  // Count comparison split by half: one half "more than N", the other half
  // "fewer than M" of a category. The player picks which toppings on each slice.
  function t_countCompareHalves(rng, av, un) {
    var cats = ['any', 'meat', 'veg'].filter(function (c) {
      return (c === 'any' ? av.length : av.filter(catTest(c)).length) >= 5;
    });
    if (!cats.length) return null;
    var cat = pick(rng, cats);
    var avail = cat === 'any' ? av.length : av.filter(catTest(cat)).length;
    var word = catWord(cat).toUpperCase();
    var n = 2, m = avail; // more-than-2 on one half; fewer-than-(avail) on the other
    var B = pickBase(rng, un);
    var L = [];
    for (var i = 0; i < 8; i++) L.push(makeSlice(B, []));
    REGION.right.forEach(function (i) { L[i] = { catCount: true, base: B, cat: cat, min: n + 1, max: avail, phrase: 'more than ' + numWord(n) + ' ' + catWord(cat) }; });
    REGION.left.forEach(function (i) { L[i] = { catCount: true, base: B, cat: cat, min: 1, max: m - 1, phrase: 'fewer than ' + numWord(m) + ' ' + catWord(cat) + ' (at least one)' }; });
    var text = 'A ' + baseWord(B) + ' base, with two number rules! On one half, every slice gets MORE THAN ' +
      numWord(n).toUpperCase() + ' different ' + word + '. On the other half, every slice gets FEWER THAN ' +
      numWord(m).toUpperCase() + ' different ' + word + ', but at least one. You pick which ones!';
    return { text: text, acceptable: rotAcc(L), teach: null, concept: 'compare' };
  }

  // Separation with buffers: keep meat and vegetables from ever touching by
  // putting a plain buffer slice between them. Ring pattern, going either way:
  // meat, buffer, veg, buffer, meat, buffer, veg, buffer. The dominant theme of
  // the Level 19-20 variations, reduced to its gradeable core.
  function t_bufferRing(rng, av, un) {
    var meats = av.filter(isMeat), vegs = av.filter(isVeg);
    if (!meats.length || !vegs.length) return null;
    var M = pick(rng, meats), V = pick(rng, vegs), B = pickBase(rng, un);
    var L = [];
    for (var i = 0; i < 8; i++) L.push(makeSlice(B, [])); // buffers are just base
    [0, 4].forEach(function (i) { L[i] = makeSlice(B, [M]); });
    [2, 6].forEach(function (i) { L[i] = makeSlice(B, [V]); });
    var text = 'Keep the meat and the vegetables apart! On a ' + baseWord(B) +
      ' base, going around in either direction: a ' + tn(M) + ' slice, then a PLAIN buffer slice, then a ' +
      tn(V) + ' slice, then a PLAIN buffer slice, and repeat. The plain buffers stop the meat ever touching the veg.';
    return { text: text, acceptable: rotAcc(L), teach: null, concept: 'notTouch' };
  }

  function tn(id) { return toppingName(id); }

  // ---------------------------------------------------------------------------
  // Customer cast + dialogue banks. Lines are split into a `meme` set (Gen-Alpha
  // slang) and a `plain` set; the UI's meme-mode toggle picks which to draw from.
  // ---------------------------------------------------------------------------
  var CAST = [
    { id: 'tralalero', name: 'Tralalero Tralala', prompt: 'Tralalero Tralala, the Italian brainrot meme: a blue cartoon shark with three legs wearing big blue sneakers, goofy grin, bright flat colors, kid-friendly, plain background' },
    { id: 'bombardiro', name: 'Bombardiro Crocodilo', prompt: 'Bombardiro Crocodilo, the Italian brainrot meme: a cartoon crocodile whose body is a little toy bomber airplane, goofy happy face, bright flat colors, kid-friendly, plain background' },
    { id: 'tungtung', name: 'Tung Tung Sahur', prompt: 'Tung Tung Tung Sahur, the Italian brainrot meme: a tall cartoon wooden-log person with a carved smiling face and little arms holding a small bat, bright flat colors, kid-friendly, plain background' },
    { id: 'ballerina', name: 'Ballerina Cappuccina', prompt: 'Ballerina Cappuccina, the Italian brainrot meme: a cartoon ballerina in a tutu whose head is a cappuccino coffee cup, dancing, cheerful, bright flat colors, kid-friendly, plain background' },
    { id: 'nonna', name: 'Nonna Pepperoni', prompt: 'a warm smiling cartoon Italian grandmother in an apron, bright flat colors, kid-friendly storybook style, plain background' },
    { id: 'chef-luigi', name: 'Chef Luigi', prompt: 'a jolly cartoon Italian chef with a big moustache and white hat, bright flat colors, kid-friendly, plain background' },
    { id: 'sixseven', name: 'Six-Seven Sam', prompt: 'an excited cartoon kid holding up six and seven fingers, big grin, bright flat colors, kid-friendly, plain background', gag: 'sixseven' },
    { id: 'wizard', name: 'Pizza Wizard', prompt: 'a friendly cartoon wizard with a pizza-slice hat and starry robe, bright flat colors, kid-friendly, plain background' },
    { id: 'astro', name: 'Astro Ant', prompt: 'a cute cartoon ant in a tiny astronaut suit, cheerful, bright flat colors, kid-friendly mascot, plain background' },
    { id: 'dino', name: 'Chompy the Dino', prompt: 'a friendly round cartoon green dinosaur with a big smile, bright flat colors, kid-friendly mascot, plain background' }
  ];

  var DIALOGUE = {
    perfect: {
      meme: ['MWAH! Chef’s kiss! Perfect pizza!', 'Bussin fr fr, no cap. Best in Ohio.',
        'You cooked. You absolutely COOKED.', '+1000 aura. You’re a pizza sigma.',
        'W pizza. Massive W. Huge.', 'This pizza has RIZZ. I’m in love.',
        'SKIBIDI delicious! Take my money!'],
      plain: ['Perfect! Exactly what I asked for!', 'Wonderful, ten out of ten!',
        'You got every bit right. Thank you!', 'Beautiful pizza. My favourite!']
    },
    great: {
      meme: ['Pretty much perfect, you legend. We move.', 'That’s a W, barely. Stay humble.',
        'Solid. Chef’s friendly nod, not quite the kiss.'],
      plain: ['Very close, nicely done!', 'Almost perfect, just a tiny bit off.', 'Great work, thank you!']
    },
    meh: {
      meme: ['Hmm. It’s giving... mid. I’ll allow it.', 'Not what I said, but I’m too hungry to argue.',
        'Half right. Half aura. We balance.'],
      plain: ['Hmm, that’s not quite right, but okay.', 'A few mistakes, but I’ll take it.', 'Not bad, could be better.']
    },
    wrong: {
      meme: ['Are you LISTENING? I said the LEFT half! L pizza!', 'This is a PIZZA CRIME. -500 aura. Reported.',
        'Bro fumbled the bag. It’s giving... unemployed.', 'My nan makes better pizza and she’s a CAT.',
        'Cooked. And NOT in the good way.', 'I’m telling EVERYONE. All of Ohio will know.',
        'That ain’t it, chief. That ain’t it at ALL.'],
      plain: ['That’s all wrong! Read it again!', 'No no no, that’s not my order!', 'You didn’t listen at all!',
        'I can’t eat this, it’s completely wrong.']
    },
    left: {
      meme: ['Took too long, chef. I’m OUT. L pizza shop.',
        'Bro this is taking DECADES. I’m ghosting.', 'Zero rizz, zero speed. I’m gone.',
        'My stomach left without me. Bye!', 'This wait is NOT bussin. Cancelled.',
        'Aura draining... I gotta dip. L.', 'I aged a whole year waiting. Peace out.',
        'Slow service is a war crime. Reported. Leaving.'],
      plain: ['Sorry, I waited too long. I have to go!', 'I’m all out of time, maybe next visit!',
        'Too slow for me today, bye!', 'My tummy gave up waiting. See you!',
        'I have to dash, that took ages!', 'No pizza is worth this wait. Goodbye!',
        'I’ll come back when you’re quicker!']
    },
    incredulity: {
      meme: ['BROCCOLI? On a PIZZA?! ...Yes. Do it. I’m built different.',
        'Green beans?! Who hurt you? Put ’em on. ALL of them.',
        'Brussels sprouts on a pizza. I’m not a hero, but I’m something.',
        'Yes, banana. Bring the banana. Bring SHAME.',
        'Marshmallows AND raisins? Dessert crime scene, and I’m the villain.',
        'Peas. On pizza. My mum would faint. Do it anyway.'],
      plain: ['Yes, I know it’s unusual. I like it that way!', 'Don’t look at me like that, just make it!',
        'It’s a funny topping, I know. Trust me!']
    }
  };

  function reactionBand(accuracy) {
    if (accuracy >= 1) return 'perfect';
    if (accuracy >= 0.8) return 'great';
    if (accuracy >= 0.5) return 'meh';
    return 'wrong';
  }
  function pickReaction(band, memeMode, rng) {
    rng = rng || defaultRng;
    var set = DIALOGUE[band] || DIALOGUE.meh;
    var lines = (memeMode ? set.meme : set.plain);
    if (!lines || !lines.length) lines = set.plain;
    return lines[Math.floor(rng() * lines.length)];
  }

  // Key the order by its EXPECTED PIZZA OUTCOME (the whole acceptable-layouts
  // set), not its text. Two differently-worded orders for the same pizza share a
  // key and so won't appear back-to-back.
  function layoutKey(order) {
    return order.acceptable.map(function (L) { return JSON.stringify(L); }).sort().join('|');
  }

  function generateOrder(opts) {
    opts = opts || {};
    var rng = opts.rng || defaultRng;
    var unlocked = opts.unlocked || UNLOCK_ORDER.slice();
    var av = availableToppings(unlocked);
    if (av.length === 0) av = ['pepperoni'];
    // Adaptive difficulty (stored by the UI) overrides the order-count ramp.
    // Tier is driven by the adaptive difficulty (tips raise it, fails/timeouts
    // lower it). The order-count ramp is only a seed for a brand-new player who
    // has no stored difficulty yet; it never gates a returning player.
    var tier = opts.difficulty ? Math.max(1, Math.min(MAX_TIER, Math.round(opts.difficulty))) : tierFor(opts.ordersServed || 0);
    var avoid = opts.avoidKey || null;
    var require = opts.require || null; // feature a just-unlocked ingredient
    var taught = opts.taught || []; // recipe names the player has already seen defined

    // Build an order; prefer one that (a) features the required ingredient and
    // (b) isn't a reworded duplicate of the previous pizza. Try several times.
    var fallback = null, reqOnly = null;
    for (var attempt = 0; attempt < 18; attempt++) {
      var order = buildOne(rng, av, unlocked, tier, taught);
      if (!order) break;
      order.tier = order.tier || tier;
      order.novelty = orderUsesNovelty(order);
      order.key = layoutKey(order);
      if (!fallback) fallback = order;
      var reqOk = !require || orderUsesTopping(order, require);
      var keyOk = order.key !== avoid;
      if (reqOk && keyOk) return order;
      if (reqOk && !reqOnly) reqOnly = order;
    }
    if (reqOnly) return reqOnly;
    if (fallback) return fallback;
    var L = paint(emptyLayout(), REGION.whole, { base: 'tomato', addTopping: av[0] });
    return { tier: 1, text: 'A whole tomato-base pizza, all ' + tn(av[0]) + '.', acceptable: pinnedAcc(L), teach: null, novelty: false, key: 'fallback' };
  }

  // Each template maps to the single idea it teaches, so the result screen can
  // open with a plain-English explanation of the CONCEPT (see Glossary.CONCEPTS)
  // instead of a per-slice diff. Templates absent here fall back to term
  // detection on the order text, so this need not be exhaustive: only list a
  // template when its hand-authored concept sentence beats the auto-detected one.
  var CONCEPT_BY_TEMPLATE = {
    t1_whole: 'whole', t_doubleWhole: 'whole', t_comboWhole: 'whole',
    t2_halfHalf: 'half', t_doubleHalf: 'half', t_tripleHalf: 'half', t_comboHalves: 'half',
    t4_quarterRest: 'quarter', t4_twoQuarters: 'quarter', t4_threeQuarters: 'quarter',
    t8_fourQuarters: 'quarter', t_threeRegion: 'quarter', t_comboQuarter: 'quarter',
    t9_quarterRecipes: 'quarter', t7_share: 'quarter',
    t5_oneSlice: 'slice',
    t5_twoAdjacent: 'nextTo', t5_threeAdjacent: 'threeInRow',
    t6_oppositeOf: 'opposite',
    t6_diagonalQuarters: 'diagonal', t7_namedDiagonal: 'diagonal',
    t6_exceptQuarter: 'except', t7_negationBase: 'except', t7_nestedException: 'except',
    t7_alternating: 'everyOther', t7_ordinalRun: 'ordinalRun',
    t_catCountWhole: 'catCount', t_catCountHalves: 'catCount', t_sillyEvery: 'catCount', t_fruitEvery: 'catCount',
    t_countCompare: 'compare', t7_layerConditional: 'intersection',
    t_catSeparate: 'notTouch', t_dietaryShare: 'notTouch', t_gapShare: 'notTouch'
  };

  function buildOne(rng, av, unlocked, tier, taught) {
    for (var t = tier; t >= 1; t--) {
      var temps = templatesForTier(t).slice();
      while (temps.length) {
        var tmpl = temps.splice(Math.floor(rng() * temps.length), 1)[0];
        var order = tmpl(rng, av, unlocked, taught);
        if (order) {
          order.tier = t; order.core = order.text;
          if (order.concept === undefined) order.concept = CONCEPT_BY_TEMPLATE[tmpl.name] || null;
          order.text = compose(rng, order.text, t, collectToppings(order.acceptable[0]));
          if (order.teach === undefined) order.teach = null;
          return order;
        }
      }
    }
    return null;
  }

  function orderUsesTopping(order, id) {
    var spec = order.acceptable[0];
    for (var i = 0; i < N; i++) {
      if (!spec[i].wildcard && !spec[i].catCount && spec[i].toppings.indexOf(id) !== -1) return true;
    }
    return false;
  }

  function orderUsesNovelty(order) {
    var spec = order.acceptable[0];
    for (var i = 0; i < N; i++) {
      var s = spec[i];
      if (s.wildcard || s.catCount) continue;
      for (var j = 0; j < s.toppings.length; j++) {
        var tp = TOPPING[s.toppings[j]];
        if (tp && tp.novelty) return true;
      }
    }
    return false;
  }

  return {
    N: N, MAX_TIER: MAX_TIER, REGION: REGION, SLICE_NAME: SLICE_NAME,
    generateOrder: generateOrder, tierFor: tierFor, availableToppings: availableToppings, permutations: permutations,
    opposite: opposite, neighbours: neighbours,
    rot: rot, reflectV: reflectV, applyPerm: applyPerm, ALL_ROTATIONS: ALL_ROTATIONS, orbit: orbit,
    makeSlice: makeSlice, emptyLayout: emptyLayout, cloneLayout: cloneLayout, paint: paint, isBare: isBare,
    BASES: BASES, TOPPING: TOPPING, RECIPE: RECIPE, UNLOCK_ORDER: UNLOCK_ORDER,
    expandRecipe: expandRecipe, recipeBuildable: recipeBuildable, buildableRecipes: buildableRecipes,
    recipeWords: recipeWords, recipeDescribe: recipeDescribe, RECIPE_ORDER: RECIPE_ORDER, toppingName: toppingName,
    grade: grade, layoutScore: layoutScore, sliceScore: sliceScore, describeMistakes: describeMistakes,
    gradePool: gradePool, reduceFraction: reduceFraction,
    CAST: CAST, DIALOGUE: DIALOGUE, reactionBand: reactionBand, pickReaction: pickReaction
  };
});
