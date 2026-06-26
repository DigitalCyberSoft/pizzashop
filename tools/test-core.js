/*
 * Node tests for game-core.js. Run: node tools/test-core.js
 * Exits non-zero on any failure (no skips, no soft passes).
 */
var Core = require('../game-core.js');

var failures = 0, count = 0;
function ok(cond, msg) {
  count++;
  if (!cond) { failures++; console.error('  FAIL: ' + msg); }
}
function eq(a, b, msg) { ok(a === b, msg + ' (got ' + a + ', want ' + b + ')'); }

// Deterministic RNG so generator tests are reproducible.
function lcg(seed) {
  var s = seed >>> 0;
  return function () { s = (1103515245 * s + 12345) >>> 0; return s / 4294967296; };
}

// Build a VALID player layout from an acceptable spec: copy fixed slices, and
// satisfy each wildcard with a genuine "surprise" (a topping not in its
// surpriseAgainst set, never bare), so a correct build scores exactly 1.0.
function fillWild(L) {
  var choices = ['olive', 'banana', 'mushroom', 'ham', 'onion', 'pepper'];
  var meats = ['pepperoni', 'ham', 'bacon', 'sausage'], veg = ['mushroom', 'olive', 'onion', 'pepper'],
    silly = ['banana', 'peas', 'broccoli', 'beetroot', 'marshmallow'], fruit = ['pineapple', 'banana', 'raisins'];
  // new construct categories: intersection (fruit AND silly), silly-only (no
  // veg/fruit), and the colour groups.
  var fruitsilly = ['banana', 'raisins'], puresilly = ['marshmallow', 'fish-heads'],
    green = ['pepper', 'spinach', 'broccoli', 'peas'], red = ['pepperoni', 'tomato-slice', 'chilli'];
  var anyList = meats.concat(veg);
  return Core.cloneLayout(L).map(function (s) {
    if (s.catCount) {
      var src = s.cat === 'meat' ? meats : (s.cat === 'veg' ? veg : (s.cat === 'fruit' ? fruit :
        (s.cat === 'fruitsilly' ? fruitsilly : (s.cat === 'puresilly' ? puresilly :
          (s.cat === 'green' ? green : (s.cat === 'red' ? red : (s.cat === 'any' ? anyList : silly)))))));
      var k = s.count != null ? s.count : (s.min != null ? s.min : 1); // fill the lower bound -> always in range
      return Core.makeSlice(s.base, src.slice(0, k));
    }
    if (!s.wildcard) return s;
    var against = s.surpriseAgainst || [];
    var t = choices.filter(function (c) { return against.indexOf(c) === -1; })[0] || 'olive';
    return Core.makeSlice('tomato', [t]);
  });
}

// ---- Geometry ----
(function () {
  var R = Core.REGION;
  eq(R.whole.length, 8, 'whole has 8');
  eq(R.left.length, 4, 'left half is 4');
  eq(R.top.length, 4, 'top half is 4');
  eq(R['top-left'].length, 2, 'quarter is 2');
  // halves are complementary
  var all = R.left.concat(R.right).sort().join(',');
  eq(all, '0,1,2,3,4,5,6,7', 'left+right = whole');
  // quarters tile the whole
  var q = R['top-left'].concat(R['top-right'], R['bottom-left'], R['bottom-right']).sort().join(',');
  eq(q, '0,1,2,3,4,5,6,7', 'quarters tile the whole');
  eq(Core.opposite(0), 4, 'opposite of 0 is 4');
})();

// ---- Transforms ----
(function () {
  var L = Core.emptyLayout();
  L[0] = Core.makeSlice('plain', ['pepperoni']);
  var r1 = Core.applyPerm(L, Core.rot(1));
  ok(r1[1].toppings[0] === 'pepperoni', 'rot(1) moves slice 0 -> 1');
  var v = Core.applyPerm(L, Core.reflectV());
  ok(v[7].toppings[0] === 'pepperoni', 'reflectV moves slice 0 -> 7');
})();

// ---- Grading ----
(function () {
  var spec = Core.emptyLayout();
  Core.paint(spec, Core.REGION.right, { addTopping: 'pepperoni' });
  Core.paint(spec, Core.REGION.left, { addTopping: 'mushroom' });
  var acceptable = [spec];

  var perfect = Core.cloneLayout(spec);
  eq(Core.grade(perfect, acceptable).accuracy, 1, 'perfect copy scores 1.0');

  var wrong = Core.emptyLayout(); // all plain
  ok(Core.grade(wrong, acceptable).accuracy < 1, 'blank pizza scores < 1');

  // Left/right mirror IS accepted (handing the pizza over flips left<->right).
  // Build the pinned acceptable via pinnedAcc so it includes the vertical mirror.
  var pinned = Core.orbit(spec, [Core.rot(0), Core.reflectV()]);
  var mirror = Core.emptyLayout();
  Core.paint(mirror, Core.REGION.right, { addTopping: 'mushroom' });
  Core.paint(mirror, Core.REGION.left, { addTopping: 'pepperoni' });
  eq(Core.grade(mirror, pinned).accuracy, 1, 'left/right mirror scores 1.0 (counter-flip)');

  // A top/bottom swap is NOT a mirror and must still be wrong.
  var tb = Core.emptyLayout();
  Core.paint(tb, Core.REGION.top, { addTopping: 'pepperoni' });
  Core.paint(tb, Core.REGION.bottom, { addTopping: 'mushroom' });
  ok(Core.grade(tb, pinned).accuracy < 1, 'top/bottom swap still scores < 1');

  // base is de-weighted to 0.4: right toppings, wrong base -> 0.6 (toppings carry
  // the placement signal, base can't prop a pizza up on its own).
  var spec2 = Core.emptyLayout();
  Core.paint(spec2, Core.REGION.whole, { base: 'cheese', addTopping: 'ham' });
  var noBase = Core.emptyLayout();
  Core.paint(noBase, Core.REGION.whole, { addTopping: 'ham' }); // base plain, toppings right
  eq(Core.grade(noBase, [spec2]).accuracy, 0.6, 'right toppings wrong base = 0.6 (base weight 0.4)');

  // "right ingredient, wrong place": one topping smeared over the WHOLE pizza when
  // only the right half wanted it must NOT pass (placement is the lesson), but it
  // still earns partial credit for using the right ingredient.
  var wantHalf = Core.emptyLayout();
  Core.paint(wantHalf, Core.REGION.whole, { base: 'cheese' });
  Core.paint(wantHalf, Core.REGION.right, { addTopping: 'green-beans' });
  var smear = Core.emptyLayout();
  Core.paint(smear, Core.REGION.whole, { base: 'cheese', addTopping: 'green-beans' });
  var smearAcc = Core.grade(smear, [wantHalf]).accuracy;
  ok(smearAcc < 0.8, 'topping smeared everywhere (only right half wanted) is refused (' + smearAcc.toFixed(2) + ')');
  ok(smearAcc > 0.5, 'but the right ingredient still earns partial credit (' + smearAcc.toFixed(2) + ')');
})();

// ---- Wildcard ----
(function () {
  var spec = Core.emptyLayout();
  Core.paint(spec, Core.REGION.right, { addTopping: 'pepperoni' });
  Core.REGION.left.forEach(function (i) { spec[i] = { wildcard: true, nonBare: true }; });

  var filled = Core.emptyLayout();
  Core.paint(filled, Core.REGION.right, { addTopping: 'pepperoni' });
  Core.paint(filled, Core.REGION.left, { addTopping: 'banana' }); // any choice
  eq(Core.grade(filled, [spec]).accuracy, 1, 'wildcard accepts any non-bare fill');

  var bareLeft = Core.emptyLayout();
  Core.paint(bareLeft, Core.REGION.right, { addTopping: 'pepperoni' });
  ok(Core.grade(bareLeft, [spec]).accuracy < 1, 'wildcard non-bare rejects a bare region');
})();

// ---- Recipe expansion ----
(function () {
  var h = Core.expandRecipe('Hawaiian');
  ok(h.toppings.indexOf('ham') !== -1 && h.toppings.indexOf('pineapple') !== -1, 'Hawaiian = ham + pineapple');
})();

// ---- Generator: every tier builds, canonical self-scores 1, ambiguous accepts a listed reading ----
// Tier is driven by difficulty (the production path); the order-count seed no
// longer gates progression, so we drive coverage with difficulty + all unlocked.
(function () {
  var rng = lcg(42);
  for (var tier = 1; tier <= Core.MAX_TIER; tier++) {
    for (var n = 0; n < 30; n++) {
      var order = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
      ok(order.acceptable.length >= 1, 'tier ' + tier + ' order has >=1 acceptable layout');
      ok(typeof order.text === 'string' && order.text.length > 0, 'tier ' + tier + ' has text');
      // building exactly an acceptable layout must score 1.0
      var player = fillWild(order.acceptable[0]);
      eq(Core.grade(player, order.acceptable).accuracy, 1, 'tier ' + order.tier + ' acceptable[0] (wildcards filled) scores 1.0');
      // a last acceptable reading also scores 1.0 (covers ambiguous orbits)
      var alt = fillWild(order.acceptable[order.acceptable.length - 1]);
      eq(Core.grade(alt, order.acceptable).accuracy, 1, 'tier ' + order.tier + ' last acceptable reading scores 1.0');
    }
  }
})();

// ---- Share template: 12 distinct arrangements over 4 quarters ----
(function () {
  // force the share template by generating tier-7 until we get the share text
  var rng = lcg(7);
  var share = null;
  // Every share order (any family) ends with "one quarter each"; match on that.
  for (var i = 0; i < 400 && !share; i++) {
    var o = Core.generateOrder({ difficulty: 16, unlocked: Core.UNLOCK_ORDER, rng: rng });
    if (/quarter each/i.test(o.text)) share = o;
  }
  ok(share, 'share template is reachable at tier 20');
  if (share) eq(share.acceptable.length, 12, 'share has 12 acceptable arrangements');
})();

// ---- Mistakes report ----
(function () {
  var spec = Core.emptyLayout();
  Core.paint(spec, Core.REGION.whole, { addTopping: 'spinach' });
  var player = Core.emptyLayout();
  Core.paint(player, Core.REGION.whole, { addTopping: 'spinach' });
  player[0] = Core.makeSlice('plain', ['cheese-as-topping']); // one wrong slice
  var g = Core.grade(player, [spec]);
  var msgs = Core.describeMistakes(player, g.closest);
  eq(msgs.length, 1, 'one wrong slice -> one mistake message');
  ok(/spinach/.test(msgs[0].wantToppings.join(',')), 'mistake names the expected topping');
})();

// ---- Screening for illogical outcomes ----
(function () {
  var rng = lcg(123);
  for (var tier = 1; tier <= Core.MAX_TIER; tier++) {
    for (var n = 0; n < 40; n++) {
      var o = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
      var canon = o.acceptable[0];
      // base-first invariant: no topping ever sits on a bare ('plain') base
      for (var i = 0; i < 8; i++) {
        var s = canon[i];
        if (s.wildcard || s.catCount) continue;
        if (s.toppings.length > 0) ok(s.base !== 'plain', 'tier ' + o.tier + ': topping requires a base (slice ' + i + ')');
      }
      // a blank pizza must never score a perfect/refusal-free pass
      ok(Core.grade(Core.emptyLayout(), o.acceptable).accuracy < 1, 'tier ' + o.tier + ': blank pizza never scores 100%');
      // no order is trivially empty
      var hasContent = canon.some(function (sl) { return sl.wildcard || sl.catCount || sl.base !== 'plain' || sl.toppings.length; });
      ok(hasContent, 'tier ' + o.tier + ': order asks for something');
    }
  }
  // dedupe: avoiding the previous pizza yields a different pizza (tier >= 4 has variety)
  var repeats = 0, trials = 60;
  for (var k = 0; k < trials; k++) {
    var a = Core.generateOrder({ difficulty: 8, unlocked: Core.UNLOCK_ORDER, rng: rng });
    var b = Core.generateOrder({ difficulty: 8, unlocked: Core.UNLOCK_ORDER, rng: rng, avoidKey: a.key });
    if (a.key === b.key) repeats++;
  }
  ok(repeats === 0, 'dedupe avoids the same pizza back-to-back (repeats=' + repeats + ')');
})();

// ---- Difficulty + creativity ----
(function () {
  ok(Core.generateOrder({ difficulty: 20, unlocked: Core.UNLOCK_ORDER, rng: lcg(5) }).tier === 20, 'difficulty 20 -> tier 20');
  ok(Core.generateOrder({ difficulty: 7, unlocked: Core.UNLOCK_ORDER, rng: lcg(5) }).tier === 7, 'difficulty 7 -> tier 7');
  ok(Core.generateOrder({ difficulty: 1, unlocked: Core.UNLOCK_ORDER, rng: lcg(5) }).tier === 1, 'difficulty 1 -> tier 1');
  // >= 100 distinct order phrasings per complexity
  for (var tier = 1; tier <= Core.MAX_TIER; tier++) {
    var seen = {}, rng = lcg(900 + tier);
    for (var n = 0; n < 800; n++) {
      var o = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
      seen[o.text] = 1;
    }
    var distinct = Object.keys(seen).length;
    ok(distinct >= 100, 'tier ' + tier + ' has >=100 phrasings (got ' + distinct + ')');
    // and the precise instruction is still gradeable to 100%
    var ord = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
    var player = fillWild(ord.acceptable[0]);
    eq(Core.grade(player, ord.acceptable).accuracy, 1, 'tier ' + tier + ' still grades canonical to 100% after creative wrap');
  }
})();

// ---- Combos, multi-topping, the surprise rule, and early funny ingredients ----
(function () {
  // recipe buildability gate
  ok(Core.recipeBuildable('Pepperoni Classic', Core.UNLOCK_ORDER), 'Pepperoni Classic buildable when all unlocked');
  ok(!Core.recipeBuildable('BBQ Chicken', ['pepperoni']), 'BBQ Chicken not buildable without its base/ingredients');
  ok(Core.buildableRecipes(Core.UNLOCK_ORDER).length >= 5, 'several recipes buildable when all unlocked');
  eq(Core.recipeWords('Hawaiian'), 'ham and pineapple', 'recipeWords lists the toppings');
  eq(Core.recipeDescribe('Hawaiian'), 'a tomato base with ham and pineapple', 'recipeDescribe names the base');
  eq(Core.RECIPE['Popeye Power-Up'].base, 'cheese', 'Popeye Power-Up is a cheese base (cheese + spinach, no hidden layer)');
  // Every recipe must be buildable from ingredients the tray actually offers: a
  // real base and toppings that each have a chip. No invisible 'cheese-as-topping'.
  Object.keys(Core.RECIPE).forEach(function (n) {
    ok(Core.RECIPE[n].base !== 'plain', n + ' has a real base');
    Core.RECIPE[n].toppings.forEach(function (t) {
      ok(t !== 'cheese-as-topping', n + ' has no invisible cheese-as-topping layer');
      ok(Core.TOPPING[t], n + ' topping "' + t + '" has a real tray chip');
    });
  });

  // a funny (novelty) ingredient unlocks early (by ~tier 3 = first 7 unlocks)
  var earlyFunny = Core.UNLOCK_ORDER.slice(0, 7).some(function (id) {
    return Core.TOPPING[id] && Core.TOPPING[id].novelty;
  });
  ok(earlyFunny, 'a funny ingredient is unlocked among the first 7 (reaches ~tier 3)');

  // tier 7 actually generates multi-topping slices AND names combo recipes
  var rng = lcg(555), multi = false, combo = false;
  var comboRe = /Hawaiian|Margherita|Meat Feast|Veggie Supreme|Pepperoni Classic|BBQ Chicken|Popeye|Dragon’s Breath|Cheesy|Gone Bananas|Lunchbox/;
  for (var n = 0; n < 300 && !(multi && combo); n++) {
    var o = Core.generateOrder({ difficulty: 16, unlocked: Core.UNLOCK_ORDER, rng: rng });
    o.acceptable[0].forEach(function (s) { if (!s.wildcard && s.toppings.length >= 2) multi = true; });
    if (comboRe.test(o.text)) combo = true;
  }
  ok(multi, 'combo tiers generate at least one slice carrying 2+ toppings');
  ok(combo, 'combo tiers name at least one combo recipe');

  // constraint-satisfaction is reachable and is an enumerated set, not a symmetry orbit
  var rng2 = lcg(77), con = null;
  for (var i = 0; i < 500 && !con; i++) {
    var c = Core.generateOrder({ difficulty: 18, unlocked: Core.UNLOCK_ORDER, rng: rng2 });
    if (/NOT touching/.test(c.text)) con = c;
  }
  ok(con, 'constraint-satisfaction order reachable at tier 18');
  if (con) {
    // every NON-adjacent pair on 8 wedges = 20 layouts (rotation/reflection safe).
    eq(con.acceptable.length, 20, 'constraint order enumerates all 20 non-touching pairs');
    // an adjacent (touching) pair must NOT score 1.0
    var adj = Core.emptyLayout();
    Core.paint(adj, Core.REGION.whole, { base: 'cheese' });
    Core.paint(adj, [2, 3], { addTopping: con.acceptable[0].filter(function (s) { return !s.wildcard && s.toppings.length; })[0].toppings[0] });
    ok(Core.grade(adj, con.acceptable).accuracy < 1, 'adjacent (touching) pair fails the no-touch constraint');
  }

  // the "surprise me" wildcard: empty fails, copying fails, a genuine choice passes
  var rng3 = lcg(321), wild = null;
  for (var k = 0; k < 500 && !wild; k++) {
    var w = Core.generateOrder({ difficulty: 13, unlocked: Core.UNLOCK_ORDER, rng: rng3 });
    if (/surprise me/i.test(w.text)) wild = w;
  }
  ok(wild, 'wildcard "surprise me" order reachable at tier 13');
  if (wild) {
    var canon = wild.acceptable[0];
    var against = null;
    canon.forEach(function (s) { if (s.wildcard && s.surpriseAgainst) against = s.surpriseAgainst; });
    ok(against, 'wildcard slice carries a surpriseAgainst set');
    // base-only, no topping on the surprise region -> fail
    var empty = Core.cloneLayout(canon).map(function (s) { return s.wildcard ? Core.makeSlice('cheese', []) : s; });
    ok(Core.grade(empty, wild.acceptable).accuracy < 1, 'an empty surprise region fails');
    // copying the named topping -> not a surprise -> fail
    var copy = Core.cloneLayout(canon).map(function (s) { return s.wildcard ? Core.makeSlice('cheese', against.slice()) : s; });
    ok(Core.grade(copy, wild.acceptable).accuracy < 1, 'copying the named topping is not a surprise -> fail');
    // a genuine new topping -> pass
    eq(Core.grade(fillWild(canon), wild.acceptable).accuracy, 1, 'a genuine surprise scores 1.0');
  }
})();

// ---- Category-count: "any 3 different meats per slice" (player's choice) ----
(function () {
  var rng = lcg(909), o = null;
  for (var i = 0; i < 800 && !o; i++) {
    var x = Core.generateOrder({ difficulty: 11, unlocked: Core.UNLOCK_ORDER, rng: rng });
    if (/any 3 different (MEAT|VEGETABLES)/.test(x.text)) o = x;
  }
  ok(o, 'category-count "3 per slice" order reachable');
  if (o) {
    var spec = o.acceptable[0];
    eq(Core.grade(fillWild(spec), o.acceptable).accuracy, 1, 'any 3 of the right category scores 1.0');
    var two = spec.map(function (s) { return s.catCount ? Core.makeSlice(s.base, s.cat === 'meat' ? ['pepperoni', 'ham'] : ['mushroom', 'olive']) : s; });
    ok(Core.grade(two, o.acceptable).accuracy < 1, 'only two (not three) fails the count');
    var wrongCat = spec.map(function (s) { return s.catCount ? Core.makeSlice(s.base, s.cat === 'meat' ? ['mushroom', 'olive', 'onion'] : ['pepperoni', 'ham', 'bacon']) : s; });
    ok(Core.grade(wrongCat, o.acceptable).accuracy < 1, 'three of the wrong category fails');
  }
})();

// ---- Count-range catCount: "more than two" / "fewer than five" ----
(function () {
  function layout(make) { var L = []; for (var i = 0; i < 8; i++) L.push(make()); return L; }
  // more than two meats -> min 3, max 6
  var more = layout(function () { return { catCount: true, base: 'tomato', cat: 'meat', min: 3, max: 6, phrase: 'more than two meats' }; });
  var fill3 = more.map(function () { return Core.makeSlice('tomato', ['pepperoni', 'ham', 'bacon']); });
  eq(Core.grade(fill3, [more]).accuracy, 1, 'more than two meats: three meats scores 1.0');
  var fill2 = more.map(function () { return Core.makeSlice('tomato', ['pepperoni', 'ham']); });
  ok(Core.grade(fill2, [more]).accuracy < 1, 'more than two meats: only two fails the count');
  var fillVeg = more.map(function () { return Core.makeSlice('tomato', ['mushroom', 'olive', 'onion']); });
  ok(Core.grade(fillVeg, [more]).accuracy < 1, 'more than two meats: three veg fails (wrong category)');

  // fewer than five toppings (any category) -> min 1, max 4
  var less = layout(function () { return { catCount: true, base: 'cheese', cat: 'any', min: 1, max: 4, phrase: 'fewer than five toppings (at least one)' }; });
  eq(Core.grade(less.map(function () { return Core.makeSlice('cheese', ['pepperoni']); }), [less]).accuracy, 1, 'fewer than five: one topping scores 1.0');
  eq(Core.grade(less.map(function () { return Core.makeSlice('cheese', ['pepperoni', 'ham', 'mushroom', 'olive']); }), [less]).accuracy, 1, 'fewer than five: four toppings scores 1.0');
  ok(Core.grade(less.map(function () { return Core.makeSlice('cheese', ['pepperoni', 'ham', 'mushroom', 'olive', 'onion']); }), [less]).accuracy < 1, 'fewer than five: five toppings fails');
  ok(Core.grade(less.map(function () { return Core.makeSlice('cheese', []); }), [less]).accuracy < 1, 'fewer than five: zero toppings fails (at least one)');

  // reachable from generation, and satisfiable via fillWild
  var rng = lcg(4242), gen = null;
  for (var i = 0; i < 1500 && !gen; i++) { var x = Core.generateOrder({ difficulty: 11, unlocked: Core.UNLOCK_ORDER, rng: rng }); if (/MORE THAN|FEWER THAN/.test(x.text)) gen = x; }
  ok(gen, 'count-compare order reachable from generation');
  if (gen) eq(Core.grade(fillWild(gen.acceptable[0]), gen.acceptable).accuracy, 1, 'generated count-compare order is satisfiable');
})();

// ---- Rotation + reflection invariance: any turn/flip of a correct build passes ----
(function () {
  var rng = lcg(808);
  for (var k = 0; k < 60; k++) {
    var o = Core.generateOrder({ difficulty: 8, unlocked: Core.UNLOCK_ORDER, rng: rng }); // rotAcc templates
    var base = fillWild(o.acceptable[0]);
    var rotated = Core.applyPerm(base, Core.rot(2)); // a quarter turn
    var flipped = Core.applyPerm(base, Core.reflectV()); // handed across the counter
    eq(Core.grade(rotated, o.acceptable).accuracy, 1, 'a rotated correct pizza still scores 1.0');
    eq(Core.grade(flipped, o.acceptable).accuracy, 1, 'a flipped correct pizza still scores 1.0');
  }
})();

// ---- Level 20 must be genuinely hard: never a trivial near-uniform pizza ----
(function () {
  var rng = lcg(2020);
  for (var n = 0; n < 80; n++) {
    var o = Core.generateOrder({ difficulty: 20, unlocked: Core.UNLOCK_ORDER, rng: rng });
    var sigs = {};
    o.acceptable[0].forEach(function (s) {
      sigs[s.wildcard ? 'w' : (s.base + ':' + s.toppings.join(','))] = 1;
    });
    ok(Object.keys(sigs).length >= 3, 'tier 20 order has >=3 distinct slice states (not a uniform pizza)');
  }
})();

// ---- New language constructs: each must be reachable, grade its canonical
// build to 1.0, reject a blank pizza, and (for category orders) reject the
// wrong category. Detected by a marker phrase in the order's core text.
(function () {
  var CONSTRUCTS = [
    { name: 'riddle', tier: 8, marker: 'Guess the topping' },
    { name: 'pronoun (it)', tier: 8, marker: 'put it on the other half' },
    { name: 'the other one', tier: 4, marker: 'the other one goes' },
    { name: 'conditional-true', tier: 16, marker: 'because that is true' },
    { name: 'elimination', tier: 17, marker: 'NOT a vegetable and NOT a fruit' },
    { name: 'either/or', tier: 14, marker: 'EITHER' },
    { name: 'not both', tier: 17, marker: 'but NOT both' },
    { name: 'intersection-category', tier: 15, marker: 'BOTH a fruit AND a silly' },
    { name: 'at-least-one', tier: 9, marker: 'AT LEAST ONE' },
    { name: 'dietary inference', tier: 14, marker: 'CANNOT eat meat' },
    { name: 'shared property (colour)', tier: 11, marker: 'share the same colour' },
    { name: 'normative keywords', tier: 15, marker: 'Order rules!' },
    { name: 'not-in-combination exception', tier: 14, marker: 'should NOT have' },
    { name: 'uneven share', tier: 18, marker: 'will eat MORE than' },
    { name: 'alternating recipes', tier: 14, marker: 'each slice between them a' },
    { name: 'checkerboard two-base', tier: 12, marker: 'Make it a checkerboard' },
    { name: 'count-compare by half', tier: 11, marker: 'two number rules' },
    { name: 'buffer separation ring', tier: 19, marker: 'PLAIN buffer slice' }
  ];
  CONSTRUCTS.forEach(function (c) {
    var found = null;
    for (var seed = 1; seed <= 4000 && !found; seed++) {
      var rng = lcg(seed * 7 + 3);
      var o = Core.generateOrder({ difficulty: c.tier, unlocked: Core.UNLOCK_ORDER, rng: rng });
      if (o && (o.core || o.text).indexOf(c.marker) !== -1) found = o;
    }
    ok(!!found, 'construct "' + c.name + '" is reachable at tier ' + c.tier);
    if (!found) return;
    eq(found.acceptable.length >= 1, true, c.name + ' has >=1 acceptable layout');
    eq(Core.grade(fillWild(found.acceptable[0]), found.acceptable).accuracy, 1, c.name + ': canonical build scores 1.0');
    eq(Core.grade(fillWild(found.acceptable[found.acceptable.length - 1]), found.acceptable).accuracy, 1, c.name + ': last reading scores 1.0');
    ok(Core.grade(Core.emptyLayout(), found.acceptable).accuracy < 1, c.name + ': blank pizza fails');
  });

  // Category orders must reject the wrong category. Build a slice that satisfies
  // a DIFFERENT predicate and confirm it scores below 1.0.
  function firstCat(tier, cat, seeds) {
    for (var seed = 1; seed <= seeds; seed++) {
      var o = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: lcg(seed * 13 + 1) });
      if (o && o.acceptable[0][0] && o.acceptable[0][0].cat === cat) return o;
    }
    return null;
  }
  // fruitsilly: a plain meat slice (pepperoni) is neither fruit nor silly -> fail.
  var fs = firstCat(15, 'fruitsilly', 4000);
  ok(!!fs, 'found a fruit-AND-silly order');
  if (fs) {
    var wrong = Core.cloneLayout(fs.acceptable[0]).map(function () { return Core.makeSlice(fs.acceptable[0][0].base, ['pepperoni']); });
    ok(Core.grade(wrong, fs.acceptable).accuracy < 1, 'fruit-AND-silly rejects a meat topping');
  }
  // puresilly: broccoli is silly but ALSO a vegetable -> must fail "not a vegetable".
  var ps = firstCat(17, 'puresilly', 4000);
  ok(!!ps, 'found a silly-only (elimination) order');
  if (ps) {
    var wrongP = Core.cloneLayout(ps.acceptable[0]).map(function () { return Core.makeSlice(ps.acceptable[0][0].base, ['broccoli']); });
    ok(Core.grade(wrongP, ps.acceptable).accuracy < 1, 'silly-only rejects broccoli (it is a vegetable)');
  }
  // green: pepperoni (red) is not green -> fail.
  var gr = firstCat(11, 'green', 4000);
  if (gr) {
    var wrongG = Core.cloneLayout(gr.acceptable[0]).map(function () { return Core.makeSlice(gr.acceptable[0][0].base, ['pepperoni']); });
    ok(Core.grade(wrongG, gr.acceptable).accuracy < 1, 'green-colour order rejects a red topping');
  }
})();

// ---- Normative keyword orders: every RFC-2119 keyword must appear, and the
// strictness (mandatory / forbidden / optional) must actually be graded. ----
(function () {
  var KEYWORDS = {
    'MUST NOT': /MUST NOT/, 'SHALL NOT': /SHALL NOT/, 'SHOULD NOT': /SHOULD NOT/,
    MUST: /MUST(?! NOT)/, SHALL: /SHALL(?! NOT)/, SHOULD: /SHOULD(?! NOT)/,
    REQUIRED: /REQUIRED/, RECOMMENDED: /RECOMMENDED/, MAY: /\bMAY\b/, OPTIONAL: /OPTIONAL/
  };
  var seen = {}, sample = null;
  [15, 18].forEach(function (tier) {
    for (var seed = 1; seed <= 3000; seed++) {
      var o = Core.generateOrder({ difficulty: tier, unlocked: Core.UNLOCK_ORDER, rng: lcg(seed * 9 + tier) });
      if (!o || (o.core || o.text).indexOf('Order rules!') === -1) continue;
      var txt = o.core || o.text;
      Object.keys(KEYWORDS).forEach(function (k) { if (KEYWORDS[k].test(txt)) seen[k] = 1; });
      if (!sample) sample = o;
    }
  });
  Object.keys(KEYWORDS).forEach(function (k) { ok(seen[k], 'normative keyword "' + k + '" appears in generated orders'); });

  ok(!!sample, 'a normative order was generated');
  if (sample) {
    // a correct build of the with-topping reading scores 1.0
    eq(Core.grade(fillWild(sample.acceptable[0]), sample.acceptable).accuracy, 1, 'normative: a compliant pizza scores 1.0');
    // the optional clause is genuinely optional: the without-topping reading is also 1.0
    eq(Core.grade(fillWild(sample.acceptable[sample.acceptable.length - 1]), sample.acceptable).accuracy, 1, 'normative: leaving the optional topping off still scores 1.0');
    // forbidden / extras: adding an unasked topping breaks it (the MUST NOT mechanic)
    var used = {};
    sample.acceptable[0].forEach(function (s) { (s.toppings || []).forEach(function (t) { used[t] = 1; }); });
    var extra = ['olive', 'banana', 'chilli', 'spinach'].filter(function (t) { return !used[t]; })[0];
    var withExtra = Core.cloneLayout(sample.acceptable[0]);
    withExtra[0] = Core.makeSlice(withExtra[0].base, (withExtra[0].toppings || []).concat([extra]));
    ok(Core.grade(withExtra, sample.acceptable).accuracy < 1, 'normative: adding a forbidden/extra topping fails');
    // mandatory clause: stripping all toppings to bare base fails (the MUST topping is gone)
    var bare = Core.cloneLayout(sample.acceptable[0]).map(function (s) { return Core.makeSlice(s.base, []); });
    ok(Core.grade(bare, sample.acceptable).accuracy < 1, 'normative: dropping the required topping fails');
  }
})();

// ---- NOT-in-combination exception: covered all over EXCEPT exactly one slice. ----
(function () {
  var o = null;
  for (var seed = 1; seed <= 4000 && !o; seed++) {
    var g = Core.generateOrder({ difficulty: 14, unlocked: Core.UNLOCK_ORDER, rng: lcg(seed * 11 + 5) });
    if (g && (g.core || g.text).indexOf('should NOT have') !== -1) o = g;
  }
  ok(!!o, 'not-in-combination exception order is reachable');
  if (o) {
    var canon = o.acceptable[0];
    var topped = canon.filter(function (s) { return s.toppings && s.toppings.length; })[0];
    var A = topped.toppings[0];
    eq(canon.filter(function (s) { return !s.toppings || !s.toppings.length; }).length, 1, 'exactly one slice is left bare');
    eq(Core.grade(fillWild(canon), o.acceptable).accuracy, 1, 'leaving one slice bare scores 1.0');
    // covering ALL eight (no exception) must fail
    var full = canon.map(function (s) { return Core.makeSlice(s.base, [A]); });
    ok(Core.grade(full, o.acceptable).accuracy < 1, 'covering every slice (ignoring the NOT) fails');
    // leaving TWO slices bare must fail
    var twoBare = Core.cloneLayout(canon); var bareCount = 0;
    twoBare = twoBare.map(function (s) {
      if (s.toppings && s.toppings.length && bareCount < 1) { bareCount++; return Core.makeSlice(s.base, []); }
      return s;
    });
    ok(Core.grade(twoBare, o.acceptable).accuracy < 1, 'leaving two slices bare fails (only one should be)');
  }
})();

// ---- Uneven share: one half split 3-to-1 between two kids. ----
(function () {
  var o = null;
  for (var seed = 1; seed <= 6000 && !o; seed++) {
    var g = Core.generateOrder({ difficulty: 18, unlocked: Core.UNLOCK_ORDER, rng: lcg(seed * 17 + 7) });
    if (g && (g.core || g.text).indexOf('will eat MORE than') !== -1) o = g;
  }
  ok(!!o, 'uneven-share order is reachable');
  if (o) {
    var canon = o.acceptable[0];
    eq(Core.grade(canon, o.acceptable).accuracy, 1, 'uneven share: the 3-to-1 split scores 1.0');
    // identify the speaker topping S (4 slices), the bigger share P (3) and the single Q.
    var counts = {};
    canon.forEach(function (s) { var k = (s.toppings || []).join(','); counts[k] = (counts[k] || 0) + 1; });
    var keys = Object.keys(counts);
    var S = keys.filter(function (k) { return counts[k] === 4; })[0];
    var P = keys.filter(function (k) { return counts[k] === 3; })[0];
    var Q = keys.filter(function (k) { return counts[k] === 1; })[0];
    ok(S && P && Q, 'uneven share has a 4 / 3 / 1 slice split');
    var base = canon[0].base;
    // an EQUAL 2-2 split of the kids' half must fail (not "more than")
    var twoTwo = canon.map(function (s) {
      var k = (s.toppings || []).join(',');
      if (k === S) return s;                      // speaker's half unchanged
      return s;                                   // placeholder; rebuilt below
    });
    // rebuild: keep the 4 S slices, make the other 4 a 2-2 split of P and Q
    var made = 0;
    twoTwo = canon.map(function (s) {
      var k = (s.toppings || []).join(',');
      if (k === S) return s;
      made++;
      return Core.makeSlice(base, [made <= 2 ? P : Q]);
    });
    ok(Core.grade(twoTwo, o.acceptable).accuracy < 1, 'uneven share: an equal 2-2 split fails');
    // giving the smaller eater ZERO (all P) must fail
    var allP = canon.map(function (s) {
      var k = (s.toppings || []).join(',');
      return k === S ? s : Core.makeSlice(base, [P]);
    });
    ok(Core.grade(allP, o.acceptable).accuracy < 1, 'uneven share: leaving the smaller eater nothing fails');
  }
})();

// ---- Multi-pizza POOL grader: optimal assignment (vs brute force), worked
// example, perfect build, fraction reduction, and the count-tiling guard ----
(function () {
  var BASES = ['tomato', 'cheese', 'bbq'], TOPS = ['pepperoni', 'ham', 'mushroom', 'olive', 'pineapple'];
  function randSlice(r) { var t = [], k = Math.floor(r() * 3); for (var i = 0; i < k; i++) t.push(TOPS[Math.floor(r() * TOPS.length)]); return Core.makeSlice(BASES[Math.floor(r() * 3)], t); }
  function bruteMax(player, cols) {
    var n = player.length, best = -1;
    Core.permutations(player.map(function (_, i) { return i; })).forEach(function (perm) {
      var s = 0; for (var i = 0; i < n; i++) s += Core.sliceScore(player[i], cols[perm[i]]); if (s > best) best = s;
    });
    return best;
  }
  // The Hungarian optimum MUST equal the brute-force optimum on every instance.
  for (var t = 0; t < 120; t++) {
    var r = lcg(t * 7 + 1), n = 4 + Math.floor(r() * 3); // 4..6 slices
    var player = []; for (var i = 0; i < n; i++) player.push(randSlice(r));
    var nk = 1 + Math.floor(r() * 3), counts = [], rem = n;
    for (var k = 0; k < nk; k++) { var c = (k === nk - 1) ? rem : 1 + Math.floor(r() * (rem - (nk - 1 - k))); counts.push(c); rem -= c; }
    var kinds = counts.map(function (cc) { return { spec: randSlice(r), count: cc }; });
    var cols = []; kinds.forEach(function (kk) { for (var cI = 0; cI < kk.count; cI++) cols.push(kk.spec); });
    var got = Core.gradePool(player, kinds).accuracy * n, want = bruteMax(player, cols);
    ok(Math.abs(got - want) < 1e-9, 'pool grader optimal (n=' + n + ')');
  }
  // Worked example from the grilling: 3 pepperoni, 9 cheese, 4 Hawaiian built
  // against a 2/10/4 order scores exactly 15/16.
  function whole(base, tops, m) { var a = []; for (var i = 0; i < m; i++) a.push(Core.makeSlice(base, tops)); return a; }
  var haw = Core.expandRecipe('Hawaiian');
  var kinds16 = [
    { spec: Core.makeSlice('tomato', ['pepperoni']), count: 2 },
    { spec: Core.makeSlice('cheese', []), count: 10 },
    { spec: Core.makeSlice(haw.base, haw.toppings), count: 4 }
  ];
  var near = whole('tomato', ['pepperoni'], 3).concat(whole('cheese', [], 9)).concat(whole(haw.base, haw.toppings, 4));
  eq(Core.gradePool(near, kinds16).accuracy, 0.9375, 'pool: 3/9/4 vs 2/10/4 scores 15/16');
  var perfect = whole('tomato', ['pepperoni'], 2).concat(whole('cheese', [], 10)).concat(whole(haw.base, haw.toppings, 4));
  eq(Core.gradePool(perfect, kinds16).accuracy, 1, 'pool: exact counts score 1.0');
  ok(Core.gradePool(whole('cheese', [], 16), kinds16).accuracy < 1, 'pool: all-one-kind blob fails');
  // fraction reduction for the teaching reveal
  eq(JSON.stringify(Core.reduceFraction(10, 16)), '[5,8]', 'reduceFraction 10/16 = 5/8');
  eq(JSON.stringify(Core.reduceFraction(2, 16)), '[1,8]', 'reduceFraction 2/16 = 1/8');
  eq(JSON.stringify(Core.reduceFraction(4, 16)), '[1,4]', 'reduceFraction 4/16 = 1/4');
  // counts must tile the pool exactly; a mismatch is a generator bug, not silent.
  var threw = false;
  try { Core.gradePool(whole('tomato', [], 8), kinds16); } catch (e) { threw = true; }
  ok(threw, 'pool: kind counts not summing to slice total throws');
})();

console.log((count - failures) + '/' + count + ' assertions passed.');
if (failures) { console.error(failures + ' FAILURES'); process.exit(1); }
console.log('OK');
