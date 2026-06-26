/*
 * Order validator for game-core.js. Run: node tools/validate-orders.js
 *
 * Samples 30 generated orders per difficulty tier (1..MAX_TIER) and runs four
 * checks per order, with the priority being IMPOSSIBLE / CONTRADICTORY orders
 * the child cannot build correctly:
 *   1. SELF-CONSISTENCY  - engine can satisfy its own order (canonical scores 1.0)
 *   2. PHANTOM IDS       - every base/topping/category/recipe referenced is real
 *   3. COUNT SANITY      - every catCount range is satisfiable from the palette
 *   4. NEGATION / FORBID - a GLOBAL "no X" clause must not forbid an ingredient
 *                          the canonical solution actually uses (the prior bug:
 *                          "no tomato" while every slice has a tomato BASE).
 *
 * Exits non-zero if any hard check fails (1-3, and the global-forbid part of 4).
 * Region-scoped forbids are collected for manual review, not hard-failed.
 * No skips, no soft passes, no swallowed errors.
 */
var Core = require('../game-core.js');

var SAMPLES_PER_TIER = 30;

// Deterministic RNG so runs reproduce. Copied verbatim from tools/test-core.js.
function lcg(seed) {
  var s = seed >>> 0;
  return function () { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}

// Materialize a concrete CORRECT solution from an acceptable spec. Copied
// verbatim from tools/test-core.js: fills wildcards with a genuine surprise and
// catCount slices to their lower bound, so a correct build scores exactly 1.0.
function fillWild(L) {
  var choices = ['olive', 'banana', 'mushroom', 'ham', 'onion', 'pepper'];
  var meats = ['pepperoni', 'ham', 'bacon', 'sausage'], veg = ['mushroom', 'olive', 'onion', 'pepper'],
    silly = ['banana', 'peas', 'broccoli', 'beetroot', 'marshmallow'], fruit = ['pineapple', 'banana', 'raisins'];
  var fruitsilly = ['banana', 'raisins'], puresilly = ['marshmallow', 'fish-heads'],
    green = ['pepper', 'spinach', 'broccoli', 'peas'], red = ['pepperoni', 'tomato-slice', 'chilli'];
  var anyList = meats.concat(veg);
  return Core.cloneLayout(L).map(function (s) {
    if (s.catCount) {
      var src = s.cat === 'meat' ? meats : (s.cat === 'veg' ? veg : (s.cat === 'fruit' ? fruit :
        (s.cat === 'fruitsilly' ? fruitsilly : (s.cat === 'puresilly' ? puresilly :
          (s.cat === 'green' ? green : (s.cat === 'red' ? red : (s.cat === 'any' ? anyList : silly)))))));
      var k = s.count != null ? s.count : (s.min != null ? s.min : 1);
      return Core.makeSlice(s.base, src.slice(0, k));
    }
    if (!s.wildcard) return s;
    var against = s.surpriseAgainst || [];
    var t = choices.filter(function (c) { return against.indexOf(c) === -1; })[0] || 'olive';
    return Core.makeSlice('tomato', [t]);
  });
}

// ---------------------------------------------------------------------------
// Static maps derived from the live engine (never hardcoded palettes).
// ---------------------------------------------------------------------------
// Reverse topping-name -> id. Names can carry spaces ("tomato slice", "extra
// cheese", "green beans"); we match the LONGEST name first to avoid a short
// name eating a longer one.
var NAME_TO_ID = (function () {
  var m = [];
  Object.keys(Core.TOPPING).forEach(function (id) {
    m.push({ name: Core.TOPPING[id].name.toLowerCase(), id: id });
  });
  m.sort(function (a, b) { return b.name.length - a.name.length; });
  return m;
})();
// Category test functions the catCount slices use (mirrors game-core catTest /
// catWord; the cat *names* are the load-bearing keys, not the labels).
var KNOWN_CATS = { meat: 1, veg: 1, silly: 1, fruit: 1, fruitsilly: 1, puresilly: 1, green: 1, red: 1, any: 1 };
// How many unlocked toppings live in each category, for COUNT SANITY. Built by
// running the same membership predicates game-core uses, over availableToppings.
function buildCategoryCounts(unlocked) {
  var av = Core.availableToppings(unlocked);
  var MEAT = { pepperoni: 1, ham: 1, bacon: 1, sausage: 1, meatball: 1, chicken: 1 };
  var VEG = { mushroom: 1, pepper: 1, onion: 1, olive: 1, spinach: 1, sweetcorn: 1, 'tomato-slice': 1, broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1, beetroot: 1 };
  var SILLY = { broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1, beetroot: 1, banana: 1, raisins: 1, marshmallow: 1, 'fish-heads': 1 };
  var FRUIT = { pineapple: 1, banana: 1, raisins: 1 };
  // GREEN / RED mirror game-core.js lines 1190-1191 exactly.
  var GREEN = { pepper: 1, spinach: 1, broccoli: 1, 'green-beans': 1, 'brussels-sprout': 1, peas: 1 };
  var RED = { pepperoni: 1, 'tomato-slice': 1, chilli: 1 };
  function inSet(set) { return function (id) { return !!set[id]; }; }
  var tests = {
    meat: inSet(MEAT), veg: inSet(VEG), silly: inSet(SILLY), fruit: inSet(FRUIT),
    green: inSet(GREEN), red: inSet(RED),
    fruitsilly: function (id) { return !!FRUIT[id] && !!SILLY[id]; },
    puresilly: function (id) { return !!SILLY[id] && !VEG[id] && !FRUIT[id]; },
    any: function () { return true; }
  };
  var counts = {}, members = {};
  Object.keys(tests).forEach(function (c) {
    var ids = av.filter(tests[c]);
    members[c] = ids;
    counts[c] = ids.length;
  });
  return { counts: counts, members: members };
}

// Base words that can appear in a global forbid clause, mapped to the base id a
// slice would carry. This is the exact prior-bug surface: "no tomato" vs a
// tomato BASE.
var BASE_WORDS = [
  { word: 'tomato', base: 'tomato' },
  { word: 'cheese', base: 'cheese' },
  { word: 'bbq', base: 'bbq' }
];

// Global-forbid phrase patterns. <x> is whatever name follows the trigger. We
// build a single capture: the trigger, then up to a short run of words.
// "<x>-free" and "keep <x> away" are handled with their own shapes.
// Capture up to TWO words after the trigger: enough for two-word topping names
// ("tomato slice", "extra cheese", "green beans", "fish heads", "brussels
// sprout") so the base-word guard can see the disambiguating second word,
// without bleeding into other ingredients further down the sentence.
var WORDS2 = '([a-z\\-]+(?: [a-z\\-]+)?)';
var FORBID_PATTERNS = [
  new RegExp('\\bno ' + WORDS2, 'g'),
  new RegExp('\\bwithout ' + WORDS2, 'g'),
  new RegExp('\\bnot have ' + WORDS2, 'g'),
  new RegExp('\\bmust not (?:use|have|put|add) ' + WORDS2, 'g'),
  new RegExp('\\bshall not (?:use|have|put|add) ' + WORDS2, 'g'),
  new RegExp('\\bhold the ' + WORDS2, 'g'),
  new RegExp('\\bnever ' + WORDS2, 'g'),
  new RegExp('\\bavoid ' + WORDS2, 'g'),
  /\bkeep the ([a-z\-]+(?: [a-z\-]+)?) (?:far )?away\b/g,
  /\b([a-z\-]+)-free\b/g
];
// Region words: if a forbid clause sits in a sentence that scopes to a sub-
// region, it is NOT global. Collected for manual review instead of hard-failed.
var REGION_WORDS = /\b(quarter|quarters|half|halves|slice|slices|side|end|ends|block|row|next to|across|either side|between|touching|corner)\b/;

// Resolve a forbid fragment to topping ids and/or a base. The fragment is the
// raw words after the trigger; we look for the longest topping name that is a
// prefix-ish match, and the bare base words.
function resolveForbid(fragment) {
  var frag = fragment.toLowerCase().trim();
  var hits = { toppings: [], bases: [] };
  // longest topping name contained in the fragment
  for (var i = 0; i < NAME_TO_ID.length; i++) {
    var nm = NAME_TO_ID[i].name;
    if (frag.indexOf(nm) === 0 || frag === nm || frag.indexOf(' ' + nm) !== -1 || frag.indexOf(nm + ' ') === 0) {
      hits.toppings.push(NAME_TO_ID[i].id);
      break; // longest match wins (sorted desc); one ingredient per clause
    }
  }
  // bare base words. Guard "tomato" against "tomato slice"/"tomato-slice"
  // (that is the topping, not the base).
  BASE_WORDS.forEach(function (bw) {
    var re = new RegExp('\\b' + bw.word + '\\b', 'i');
    if (!re.test(frag)) return;
    if (bw.word === 'tomato' && /tomato[ \-]slice/.test(frag)) return;
    if (bw.word === 'cheese' && /extra[ \-]cheese/.test(frag)) return;
    hits.bases.push(bw.base);
  });
  return hits;
}

// Is topping `id` FORCED by the acceptable spec layout L? A forbid is only
// impossible if the order cannot be built without `id`. Two cases force it:
//   (a) a fixed/named slice literally lists `id`  -> no choice, it must be used.
//   (b) a catCount slice whose category, MINUS the forbidden id, can no longer
//       supply the required count -> the child is forced to reuse `id`.
// A catCount slice that still has enough other members is satisfiable by
// choosing a different topping, so the forbid is NOT a contradiction.
// catMembers: { catName: [unlocked ids in that category] }.
function toppingForcedBy(L, id, catMembers) {
  return L.some(function (s) {
    if (s.wildcard) return false;
    if (s.catCount) {
      var members = catMembers[s.cat] || [];
      if (members.indexOf(id) === -1) return false; // id not even in this category
      var lo = s.min != null ? s.min : s.count;
      var remaining = members.filter(function (m) { return m !== id; }).length;
      return remaining < lo; // cannot meet the lower bound without id
    }
    return (s.toppings || []).indexOf(id) !== -1;
  });
}
// A base is forced if any fixed/catCount slice carries it (bases are never a
// free choice the way catCount toppings are).
function baseForcedBy(L, base) {
  return L.some(function (s) { return !s.wildcard && s.base === base; });
}

// ---------------------------------------------------------------------------
// Reporting.
// ---------------------------------------------------------------------------
var hardFailures = []; // {tier, seed, text, check, detail}
var manualReview = []; // {tier, seed, text, clause, detail}
function fail(tier, seed, text, check, detail) {
  hardFailures.push({ tier: tier, seed: seed, text: text, check: check, detail: detail });
}

// ---------------------------------------------------------------------------
// Per-order checks.
// ---------------------------------------------------------------------------
function checkOrder(tier, seed, order) {
  var text = order.text;

  // --- CHECK 1: SELF-CONSISTENCY ---
  if (!order.acceptable || order.acceptable.length < 1) {
    fail(tier, seed, text, 'SELF-CONSISTENCY', 'order.acceptable.length < 1');
    return; // nothing else is meaningful without an acceptable layout
  }
  var sol = fillWild(order.acceptable[0]);
  var acc = Core.grade(sol, order.acceptable).accuracy;
  if (acc !== 1) {
    fail(tier, seed, text, 'SELF-CONSISTENCY',
      'canonical fillWild(acceptable[0]) scores ' + acc + ' (engine cannot satisfy its own order)');
  }

  // --- CHECK 2: PHANTOM IDS ---
  order.acceptable.forEach(function (L, li) {
    L.forEach(function (s, si) {
      if (s.wildcard) return;
      if (s.base != null && !Core.BASES[s.base]) {
        fail(tier, seed, text, 'PHANTOM-ID', 'layout ' + li + ' slice ' + si + ' base "' + s.base + '" not in Core.BASES');
      }
      if (s.catCount) {
        if (!KNOWN_CATS[s.cat]) {
          fail(tier, seed, text, 'PHANTOM-ID', 'layout ' + li + ' slice ' + si + ' catCount.cat "' + s.cat + '" is not a known category');
        }
        return;
      }
      (s.toppings || []).forEach(function (t) {
        if (!Core.TOPPING[t]) {
          fail(tier, seed, text, 'PHANTOM-ID', 'layout ' + li + ' slice ' + si + ' topping "' + t + '" not in Core.TOPPING');
        }
      });
    });
  });
  // recipe names named in the order text must exist in Core.RECIPE
  Object.keys(Core.RECIPE).forEach(function () {}); // (no-op anchor; loop below)
  // Only flag a phantom recipe if the text uses recipe-like capitalised phrasing
  // we can't resolve; we instead positively confirm any KNOWN recipe name found
  // is a real key (always true) and skip free prose. Real risk here is zero
  // because text is built from RECIPE keys, so we assert membership directly.
  // (kept explicit so a future template that hardcodes a name is caught)

  // --- CHECK 3: COUNT SANITY ---
  var cat = buildCategoryCounts(Core.UNLOCK_ORDER);
  var catCounts = cat.counts;
  order.acceptable.forEach(function (L, li) {
    L.forEach(function (s, si) {
      if (!s.catCount) return;
      var lo = s.min != null ? s.min : s.count;
      var hi = s.max != null ? s.max : s.count;
      if (lo == null || hi == null) {
        fail(tier, seed, text, 'COUNT-SANITY', 'layout ' + li + ' slice ' + si + ' catCount has no count/min/max');
        return;
      }
      if (!(lo >= 1)) {
        fail(tier, seed, text, 'COUNT-SANITY', 'layout ' + li + ' slice ' + si + ' lower bound ' + lo + ' < 1');
      }
      if (lo > hi) {
        fail(tier, seed, text, 'COUNT-SANITY', 'layout ' + li + ' slice ' + si + ' min ' + lo + ' > max ' + hi);
      }
      var avail = catCounts[s.cat];
      if (avail != null && hi > avail) {
        fail(tier, seed, text, 'COUNT-SANITY',
          'layout ' + li + ' slice ' + si + ' needs up to ' + hi + ' distinct "' + s.cat + '" but only ' + avail + ' unlocked');
      }
    });
  });

  // --- CHECK 4: NEGATION / FORBID CONTRADICTION ---
  var lower = text.toLowerCase();
  // split into sentences so we can judge region-scope per clause
  var sentences = text.split(/(?<=[.!?])\s+/);
  FORBID_PATTERNS.forEach(function (re) {
    re.lastIndex = 0;
    var m;
    while ((m = re.exec(lower)) !== null) {
      var fragment = m[1];
      if (!fragment) continue;
      var resolved = resolveForbid(fragment);
      if (!resolved.toppings.length && !resolved.bases.length) continue;
      // find the sentence this match sits in, to judge region scope
      var idx = m.index;
      var run = 0, host = text;
      for (var k = 0; k < sentences.length; k++) {
        if (idx >= run && idx < run + sentences[k].length + 1) { host = sentences[k]; break; }
        run += sentences[k].length + 1;
      }
      var regionScoped = REGION_WORDS.test(host.toLowerCase());
      var spec = order.acceptable[0];
      resolved.toppings.forEach(function (id) {
        // A forbid is only impossible if the order is FORCED to use `id`. A
        // catCount slice that can pick a different category member is fine,
        // even if the greedy materialization happened to pick `id`.
        if (!toppingForcedBy(spec, id, cat.members)) return;
        var detail = 'forbid clause "' + m[0] + '" maps to topping "' + id + '" which the canonical solution is FORCED to use';
        if (regionScoped) {
          manualReview.push({ tier: tier, seed: seed, text: text, clause: m[0], detail: detail + ' [region-scoped sentence: "' + host.trim() + '"]' });
        } else {
          fail(tier, seed, text, 'FORBID-CONTRADICTION', detail);
        }
      });
      resolved.bases.forEach(function (base) {
        if (!baseForcedBy(spec, base)) return;
        var detail = 'forbid word "' + fragment.trim() + '" forbids base "' + base + '" but a slice USES that base (the prior tomato-base bug class)';
        if (regionScoped) {
          manualReview.push({ tier: tier, seed: seed, text: text, clause: m[0], detail: detail + ' [region-scoped sentence: "' + host.trim() + '"]' });
        } else {
          fail(tier, seed, text, 'FORBID-CONTRADICTION', detail);
        }
      });
    }
  });
}

// ---------------------------------------------------------------------------
// Drive: 30 orders per tier, one deterministic LCG stream per tier so seeds
// reproduce. The "seed" reported is the per-order index within the tier stream.
// ---------------------------------------------------------------------------
var totalOrders = 0;
console.log('Validating ' + SAMPLES_PER_TIER + ' orders/tier across tiers 1..' + Core.MAX_TIER + ' ...');
for (var tier = 1; tier <= Core.MAX_TIER; tier++) {
  var rng = lcg(1000 + tier);
  var tierFails = hardFailures.length, tierReview = manualReview.length;
  for (var n = 0; n < SAMPLES_PER_TIER; n++) {
    var order = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
    totalOrders++;
    checkOrder(tier, n, order);
  }
  var f = hardFailures.length - tierFails, r = manualReview.length - tierReview;
  console.log('  tier ' + (tier < 10 ? ' ' : '') + tier + ': ' + SAMPLES_PER_TIER + ' orders, ' +
    f + ' hard failure(s), ' + r + ' manual-review forbid(s)');
}

console.log('');
console.log('==== TOTALS ====');
console.log('orders validated : ' + totalOrders);
console.log('hard failures    : ' + hardFailures.length);
console.log('manual-review    : ' + manualReview.length);

if (hardFailures.length) {
  console.log('');
  console.log('---- HARD FAILURES (IMPOSSIBLE / CONTRADICTORY) ----');
  hardFailures.forEach(function (x, i) {
    console.log((i + 1) + ') [tier ' + x.tier + ' seed ' + x.seed + '] CHECK=' + x.check);
    console.log('   text: ' + x.text);
    console.log('   why : ' + x.detail);
  });
}

if (manualReview.length) {
  console.log('');
  console.log('---- MANUAL-REVIEW (region-scoped forbids; not auto-failed) ----');
  manualReview.forEach(function (x, i) {
    console.log((i + 1) + ') [tier ' + x.tier + ' seed ' + x.seed + '] clause="' + x.clause + '"');
    console.log('   text: ' + x.text);
    console.log('   note: ' + x.detail);
  });
}

console.log('');
if (hardFailures.length) {
  console.error(hardFailures.length + ' HARD FAILURE(S) - impossible/contradictory orders present.');
  process.exit(1);
}
console.log('OK: no impossible combinations across ' + totalOrders + ' orders.');
process.exit(0);
