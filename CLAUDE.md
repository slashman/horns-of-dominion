# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Horns of Dominion** — a real-time-with-pause strategy game for the js13kgames budget. Twenty cities on a procedural node graph, five realms, total-conquest victory. No assets: every pixel is generated, the art is emoji plus flat canvas geometry.

The defining constraint is **13,312 bytes zipped**, enforced at build time (`build.mjs` exits non-zero over it). Every design decision is downstream of that.

## Commands

    npm install
    npm run dev      # esbuild watch + static server on :8080, rebuilds on save
    npm run build    # dist/index.html + dist/game.zip; FAILS if over 13312 B
    npm run size     # one line: "<zipped> / 13312 (<pct>%)"
    node build.mjs --raw   # skip roadroller, to A/B against the unpacked pipeline

**Only `npm run build` / `npm run size` report a real number.** `--dev` skips minification and the packing stages below, so its figure is meaningless and always over budget. Reading a dev number as if it were real has wasted time here repeatedly.

**A stale `dist/` fails `dist-test` for no reason.** Anything that rebuilds with modified or stubbed sources — a measurement script, a running dev server — leaves `dist/` behind. Rebuild before believing a `dist-test` failure.

### The build pipeline

Four stages. The last three were worth ~2,200 B when added, more than everything ever cut from the game:

1. **esbuild** bundles and minifies to an IIFE, **and mangles our own property names** (`MINE` in `build.mjs`). esbuild does not do this by default and roadroller does not make long names free: it is worth **~316 B**, which was more than every feature cut on the table put together, and it costs nothing in the source because the rename happens at build time. It is an allowlist and must stay one — mangling renames a property everywhere in the bundle, so any name that is *also* a builtin or DOM property breaks where our renamed access meets an object we do not own. `split` was in the first draft and turned `"a b c".split(' ')` into `.D()`. `dist-test` is the only harness that can catch this, because it is the only one that runs the packed bundle; it fails on `split`, `sort` or `dataset` being added, all three tried. Round 31 added five more names that were sitting in plain sight — `init`, `generate` and `createWave` (player.js's own methods) and `start` / `again` (the two `hooks`) — for **28 B**, which is most of what the onboarding rewrite in the same round cost. `size` is the one that looks like ours and is not: it is a `Map`'s, and `play` / `pause` / `loop` / `currentTime` are an `Audio` element's.
2. **Roadroller** re-encodes the bundle as a self-extracting payload (`optimize(1)`; level 2 buys ~10 B for 25 s, not worth it).
3. **The stylesheet is folded into that payload** rather than left in the HTML shell, so Roadroller's model sees it too. Only `body{background:#0b0a12}` stays behind — without it the page flashes white for as long as decompression takes.
4. **The zip is assembled by hand** with `@gfx/zopfli`: one entry, no extra fields. `zip -9` wrote 170 B of container where 118 suffices, and Info-ZIP's own deflate ran 224 B behind plain zlib before zopfli improved on that again. The DOS timestamp is pinned so builds are reproducible.

**The build is not byte-deterministic** — Roadroller's search varies output by roughly ±20 B run to run. Never chase a saving smaller than that, and leave margin rather than landing exactly on the limit.

Historical warning: `advzip`/`ect` used to be shelled out to inside a bare `catch {}`, and neither was installed, so every size figure before phase 13 was plain `zip -9`. Don't reintroduce a silent fallback; the build names the compressor it actually used.

## Tests

There is no test runner. Each harness is a standalone `.mjs` that imports the real `src/` modules, prints `ok`/`FAIL` lines, and exits non-zero. Run one directly:

    node cmd-test.mjs     # flee cost, pathing, splitting, muster, engagement bookkeeping, civil unrest, unit kinds
    node road-test.mjs    # road engagements, deterministic army placements, no AI
    node dom-test.mjs     # drives the real modules against a stub browser
    node dist-test.mjs    # plays a whole war in the shipped, packed dist/index.html

Two more that inspect rather than assert:

    node shot.mjs [seed] [frames] [out.svg]   # render one frame to SVG — see "Visual work" below
    node geo.mjs  [seeds]                     # features right across the frame? counts? forest cover?

`dist-test` used to boot the bundle, run forty ticks and stop. Since the build mangles property names it is the only thing standing between a bad allowlist entry and a broken release, so it now **plays a game to its ending** — sieges, unrest, revolts, stamina, crumbling realms, the calendar rolling over, the victory check — and it **stubs `Audio`**, which it never did before. That guard mattered: `audio.js` switches itself off on `typeof Audio`, so the packed build's song and effects were the one part of the bundle no harness had ever run. The whole file still takes about a second and a half.

**Run each separately and check `$?`.** Chaining with `&&` and piping to `tail` has masked a non-zero exit here before.

Balance harnesses (slow, minutes):

    node probe.mjs [rung] [count] [seedBase]       # default 2 200 3000 — the player's seat
    node sim-test.mjs [seedBase] [rung] [count]   # default 1000 2 400 — headless games
    node sim-test.mjs 5000 2 200                  # a second seed range, to tell bias from noise
    node diff-test.mjs [gamesPerRung]             # is the difficulty ladder monotonic?
    node bias.mjs                                 # starting-position parity across realm slots
    node dbg.mjs <n> / node worst.mjs             # single-game trace / worst-tail hunt

## Architecture

### The tick, and what scales with what

`src/state.js` opens with `const P = 0.1` — the global pace knob. It multiplies every **rate** (gold, growth, march speed, attrition, siege, mending, unrest, AI cadence) and leaves every **quantity** alone (costs, warriors, wall points). Tick-denominated thresholds are written `x / P`. Change `P` and the whole game speeds up or slows down without a single balance ratio shifting.

`T` in `state.js` is the single balance surface — every tunable lives there, nowhere else, `T.K` and `T.sp` included. `D` is the four-rung difficulty table; its multipliers apply to AI factions only, the player is always `D[1]`.

The loop is fixed-timestep: `main.js` accumulates real time, runs `tick()` + `ai()` at 0.5 s per tick scaled by `S.speed`, and renders every frame with `S.alpha` interpolation. `src/sim.js` `tick()` is one ordered pass — income, road battles and movement, stack merging, node battles, sieges and capture, civil unrest, stamina, mending, crumbling realms, notifications, victory. Order matters; the numbered comments in `tick()` are load-bearing.

### Derived state, not stored state

Three things are deliberately **pure functions of the current board**, with nothing to persist, reset or keep in sync. Reintroducing a stored flag for any of them is a regression:

- **Fog of war** (`seeCity` / `seeRoad` / `seeArmy` in `sim.js`). Reveals last only while a host is present. The fog hides intel *and* battle effects and capture flashes — but never geography, which greys out instead; fogged roads go dotted rather than dim. The AI plays with full information.
- **Command** (`active()` in `sim.js`). Selecting one of your own warbands *is* what puts it under command; there is no separate targeting flag.
- **Terrain** (`src/terrain.js`). Nothing about the field is stored on the map; it is baked from `S.seed` alone, and only the peaks read the cities at all — to keep off them.

Because fog touches nothing in the simulation, `sim-test.mjs` must return **numerically identical** results before and after any fog change. That invariant is the strongest available proof of non-interference — use it.

**The march path rides beside its road, not down it.** The dashed line to a lit destination used to be laid exactly on the road, in the same 2px stroke, so the thing the player most needs to follow was the thing hardest to see. Each leg is now offset 6px square to *its own* direction — left of the march — which is the only offset that holds at any road angle; a plain vertical nudge collapses to nothing on a north-south leg, and that is the case `dom-test` measures (perpendicular distance from the road line, not distance from the city). The test reads it off a recording of the canvas path ops, keyed on the path's own `#e8e4f5aa` stroke.

### Commanding warbands

Click one of your hosts and it is under command (the canvas cursor becomes a crosshair). Click a city and it marches there, staying under command so the order can be redirected. Click anywhere else and it stands down. There are no movement buttons.

**A city must win the hit test over a host standing on it** — `to = hc >= 0 ? hc : …` in `main.js`. At progress 0 a marching host sits exactly on the city it left, so if the host won, a march could never be turned around. There is a test for this; keep it.

**Tapping another of your own hosts hands command to it**, and tapping an enemy is an order to go and meet it. Both were dead taps before: a friendly host that was not resting on a city, and any host on a road, both fell through to `to = -1` and stood the warband down, so the click read as doing nothing.

The handover is gated on `hc < 0` — there must be no city under the tap — because the rule above still has to hold. That gate is only observable on a host drawn **on** a city: a resting host sits at `cityR + 17` while the city answers to `cityR + 6`, so it can never shadow one, but a host marching out at progress 0 is drawn dead on the centre and would otherwise answer the tap that was meant to send a second host in to reinforce. `dom-test` tests it on exactly that host, and asserts the 15px overlap first so the case cannot quietly stop being the case. The host already under command is excluded by id, which is what keeps the turn-a-march-around rule working.

For an enemy the destination is derived: `ha.t < 0 ? ha.a : ha.t === act.a ? ha.a : ha.t` — a resting enemy is its own city, a column is **where it is going**, unless you are standing there already, in which case it is **where it came from**. Standing at its destination and marching to its origin is the head-on case; standing at its origin and marching to its destination is the chase. Four mutations are checked: the handover deleted, the `hc < 0` gate dropped, the column case reverted to resting-hosts-only, and the column always read as its origin.

### The backdrop is baked

`terrain.js` renders the ground — grass, woods, mountains — once per map into an offscreen canvas at `paint()`, called from `fresh()` in `main.js`. The live frame pays one `drawImage` and nothing else, so detail inside `paint()` is free.

Terrain runs **its own RNG**, seeded off `S.seed`. It must never draw from `state.js`'s `rnd()`, or the browser's simulation would drift away from the headless harnesses and every balance number would stop meaning anything.

**The land has no edge.** Round 21 deleted the floating island — the convex-hull coastline, the cliff band, the seven stacked copies of it that made the rock underside, the drifting rubble, and the sunset gradient behind it all. What replaced it is a field: `paint()` fills a rect that runs 500 world units past the map on every side, mottles it with soft patches of lighter and darker grass, and scatters 165 woods and up to 13 peaks across the whole of it. The map is 1000×700; the bake is 2000×1560, so on any ordinary screen the ground leaves the frame instead of ending in it. **That is why `GROUND` is exported and `render.js` clears the frame to it** — a viewport too tall or too wide for the bake runs out into more of the same colour, with no seam to see. Do not put a gradient on the field for that reason: any gradient baked into the ground would have to end at the bake edge and the join would show.

A screen-space vignette was built and measured and then **rejected on price**: a radial gradient made in `resize()` and laid over the ground right after `blit` — before any road, city or host, so it dimmed only the backdrop — read well and had no seam, because it never touched the bake. It cost **67 B**. That is the going rate if the flat frame ever needs weight again; it was not worth it at 612 B of headroom.

Two consequences of losing the coast. **`inside()` is gone, and with it every clip and rejection test that referenced it** — woods no longer have to check that a canopy blob is on land, which is what the old comment about never slicing a canopy flat along a cliff was protecting. And the view changed with it: `resize()` scales the map at **0.92** of the frame rather than 0.72, and the `-70` upward nudge that made room for the rock below is gone, because there is no longer anything to centre the island in. (On a portrait frame that 0.92 is applied to the height alone — see "The camera, and a phone" below.)

The peaks kept all their clearance rules — 44 + extent from a city, 20 + a third of the extent from a road, 74 from each other, and they must stand in a wood — because a mountain is a silhouette that would otherwise swallow a road. Woods deliberately do not: they run under roads and cities, which are drawn over the backdrop anyway. `geo.mjs` measures exactly that split and is the tool for judging a terrain change: forest cover sits at **p10 42% / median 49% / p90 53%** over 200 seeds, 13 peaks a seed, and it fails loudly if any cell of a 4×3 grid over the visible frame comes up with no canopy in it.

### The camera, and a phone

Until round 25 there was no camera: `resize()` fitted the whole board into the frame and that was the view, forever. On a phone that meant `min(w / W, h / H)` picked the *narrow* axis — a 390-wide frame put the board at 0.36, a city's name four pixels tall, and left two thirds of the height as empty field. The board now fits the frame's **height** there and the player pans across its width.

**The new rule is the old rule on any landscape frame, exactly.** `V.s` is `max(min(w / W, h / H), min(h / H, 1.5)) * 0.92` on a first sizing, and whenever `w / W >= h / H` the first term is already `h / H` and wins — so every desktop frame scales and centres to the byte it always did. The 1.5 cap is what stops a very tall frame zooming until one city fills it. `dom-test` asserts the landscape case against the literal old formula, which is the assertion that would catch a "clever" rewrite of this.

**The camera is the two offsets the projection already had.** There is no world-space camera point and no separate zoom state: `V.ox` / `V.oy` *are* the camera, `look()` clamps them, and `toWorld` is unchanged. The clamp is written as `max(c - m, min(c + m, v))` about the **centred** offset with a margin of `max(0, (W * V.s - w) / 2)` — so on an axis the board already fits the margin is zero and the offset is pinned dead centre, which is why the desktop view cannot drift even by a rounding error. Panning is `V.ox += dx`, and needs no division by the scale for exactly that reason.

**The bottom of a narrow frame is the one place the clamp is deliberately loose.** The panel sits along that edge on a phone, and the board fits the height exactly, so `my` is 0 and the clamp left **no vertical travel at all** — a city behind the panel could not be brought out from under it, and so could never be marched to. The lower bound alone, and only when `innerWidth <= NARROW` (700, which must match the media query in `style.css`), gets half a screen of extra room. Three properties are load-bearing and each has its own assertion: it is **asymmetric** (dragging back down still stops at the resting place), it is **narrow-only** (a wide frame gets none, which needs an *upward* drag to test — the first version of that assertion dragged down and passed with the slack leaking everywhere), and panning past the map is safe to look at because the ground bake runs 500 world units past it on every side.

Three entry points, and each is one line of intent: `pan(dx, dy)` slides, `gaze(gx, gy)` centres the frame on a world point, `zoom(k, px, py)` scales about a screen point by keeping `px - V.ox` proportional. Zoom is floored at `V.lo` — the scale that shows the *whole* board, so a pinch-out can always get the player back to the overview — and capped at 2.5.

**A resize keeps the player's zoom.** `V.s` starts at 0 and only a first sizing computes the fit; every later `resize()` re-clamps what is there. That is not tidiness — a mobile browser fires a resize every time its URL bar hides or shows, and recomputing the fit would yank the view mid-drag.

**The war opens over your own holdings.** `hooks.start` gazes at the mean position of the cities you hold, because on a phone the board is wider than the frame and the middle of the map is nobody's home. It is a two-line reduce in `main.js` and it needs no new state. On a desktop frame it does nothing visible: the clamp pins both axes centre, which `dom-test` asserts as its own case so nobody "fixes" the pin later.

**A pointer that stays put is a click; one that travels is the map.** This is the one change with teeth, because the tap now fires on **pointerup**, not pointerdown — a press cannot be known to be a click until the finger lifts without having gone anywhere. `main.js` keeps a `Map` of live pointers: one moving past 7px of slop starts a pan and forfeits the tap, two of them pinch about their midpoint, and `pointercancel` cleans up. `pointermove` and `pointerup` are on the **window**, not the canvas, or a drag that ends over the HUD would never release. The slop matters on desktop too: a mouse click with any tremor in it used to be a click and still is.

`dom-test`'s `tap()` helper fires a down and an up at one spot, and a new `swipe()` fires down, move, up. The drag-is-not-a-click assertion is the one to be careful with — it drags so as to *end on* a city, because a drag that ends anywhere else would select nothing whether or not the code tracked drags, and that version of the test passed with the tracking deleted. It is a vertical drag on a frame whose height already fits, so the clamp holds the board still and the release lands on the disc.

**The chrome moves out of the width's way at 700px.** One media query: the status bar wraps to two rows (`.sp` takes `flex-basis:100%`, so the speed buttons get a line of their own and stretch into touch targets), the date sheds ` of the Mazurian Age` — which rides in its own `.ag` span for that reason alone, and `dom-test` carries the span verbatim so deleting it fails loudly — and `#pan` unpins from the right edge to sit along the bottom, where a thumb is. `#cv` gets `touch-action:none`, without which the browser eats a drag as a scroll and a pinch as a page zoom before the canvas hears about either, and the viewport meta gets `user-scalable=no` to kill double-tap zoom. `viewport-fit=cover` and `env(safe-area-inset-*)` were written, measured at **59 B**, and dropped: without `cover` a phone keeps the page inside its own safe area anyway, which is the same result for nothing.

**This round landed over budget, and round 28 paid for it — not by cutting any of it.** The camera, the pointer rework, the centring and the media query cost **~520 B** against 80 B of headroom, and `npm run build` exited non-zero for four rounds: ~13,750 as it landed, ~13,600 once round 26 gave 158 B back, ~13,550 after the onboarding move. What closed the gap was property mangling in the build (see "The build pipeline"), worth ~316 B on its own, which took it to **13,223 with 89 B of headroom** — every feature intact. Round 24 shipped at 13,232, so the phone support is, in the end, free. Nothing was found to trim first: `fix` / `canFix` / `T.repair` and the largest-host stat are already gone, and a grep for the other removed features turns up no dead code. The measured menu is kept in case it is ever needed again: wheel-zoom was cut for **29 B**, pinch-zoom and `zoom()` together are **101 B**, the whole media query is **102 B**, and safe-area handling was **59 B**. Note what the mangling result says about that list — the cheapest byte in this repo was never in a feature, it was in the build, and nobody had looked. Remember the ±20 B of roadroller noise before reading any of these figures too closely.

### Three kinds of warband

`T.K` is the whole unit system: one row per kind, `[field power, wall power, march speed, gold, pop, glyph]`, indexed by `a.k`. Positional on purpose — esbuild does not mangle property names, so `K[k][0]` ships one character at each read site where `K[k].pow` would ship four. Footmen are row 0, all `1.0`, priced as an army always was.

**That makes the identity invariant the strongest test available**: with `T.sp` stubbed to all-zero, `sim-test` must return *numerically identical* results to the round-14 baseline. Use it before tuning anything — it is what proves the weighting was threaded everywhere rather than mostly.

`pw(a) = a.w * T.K[a.k][0]` is the field weight, and every place strength is summed goes through it: `melee`, `odds`, and all four AI comparisons. Walls take a second sum (`ram`) against `T.K[a.k][1]`, while besieger blood is still shared by raw bodies. **`garrison()` in `sim.js` is deliberately unweighted** — sitting on a populace is done with boots, a behemoth is not worth two footmen at it, and weighting it would move round 14's balance. There is a test that fails if someone "fixes" it.

`w` counts bodies everywhere else too — the number under a host, the split slider, `T.raiseW`. Only speed, price and combat weight differ by kind.

Specialists belong to the *place*: `c.sp` is set once in `genMap` on each realm's capital and its next biggest city, and survives conquest like `na`. Chosen **without `rnd()`** on purpose — spending randomness there would shift the whole game's stream and invalidate every balance number.

**The AI must not raise flyers.** It scores targets purely by adjacency and never reads `T.speed`, so it cannot cash in a unicorn's speed, while the `/ T.K[a.k][1]` wall term makes even an undefended city look impossible to one. Letting it raise them stalled 36 of the first 40 games in a 400-game run, every one at 19 cities against 1: flyers that will not siege still drift between friendly cities, burning the single march order a turn buys. The gate is `T.K[c.sp][1] >= 1` — behemoths yes, unicorns never. This is the same class of fact as "the AI never splits hosts": measured, and not a bug to fix without evidence.

**The AI reads march time, and its army ceiling is priced in gold.** `eta(a, j)` is the only place it looks at a road length; `soon()` discounts every target score by `T.muster / (T.muster + eta)`, so a prize is worth what it costs to reach, and siege relief picks whoever arrives first rather than whoever comes first in `S.A`. The standing-army cap counts **gold spent in footman-equivalents** (`a.w * T.K[a.k][3] / T.K[0][3]`), which is the only measure that does not inflate the board: counting bodies let a behemoth realm field 2.2x the power for one cap, and counting fighting strength let a cheap flyer realm field 1.67x the bodies. Both made wars drag.

**Because the AI's targeting itself changed, the round-14 identity invariant no longer holds** and should not be expected to. It served its purpose in round 15; from here the baseline is round 16's own numbers.

**Speed is a combat stat in the open, and nowhere else.** Two layers, both derived from `T.K[k][2]`, so there is no matchup table and no new column. `might(a, open)` scales `pw` by `(1 + speed) / 2` on a road — that is the aggregate weight `odds()` reads. `strike(a, b, open)` then adds the **ambush**: `melee` already aims each host at one *particular* enemy, so the matchup can be read off the two march rates as `1 + (speedA - speedB) * T.amb`, floored at 0.2. Outpace what you land on and you caught it strung out; behind walls both layers are 1, because nothing outruns masonry. `afield(g)` separates the cases by `g[0].t >= 0`, which is exact — a road cluster is all marchers, a node fight all resters.

The triangle **inverts with the ground**. On a road, unicorns break footmen, footmen break behemoths, and unicorns maul behemoths worst of all. At a wall it is the exact reverse. That means footmen now beat behemoths in the open, which is the point: a behemoth is a siege engine, not a strong generalist.

**Body count is hit points.** Damage in `melee` comes off `a.w`, while `T.K[k][0]` only multiplies output. So for equal gold a half-sized host of double-strength warriors trades evenly on damage and dies twice as fast: 50 behemoths lose to 100 footmen in any straight fight. Behemoths are a siege arm, not a field arm — their edge is that `T.sgLoss * c.d` is charged per tick regardless of what you are, so breaching faster simply costs fewer lives. Do not read `T.K[k][0]` as general strength.

**A flyer's lethality does not convert into victory, and this is now measured three ways.** Cheap flyers, elite flyers, and elite flyers the AI actively hunts columns with — all the same answer. The cleanest run is the `T.wing` sweep at 150 games a rung: with unicorn realms at **0%** commitment they sit at exact parity (30 wins against the behemoth realms' 30); at **30%** they fall to 24 against 38. Monotonic. **Every coin spent on flyers is a coin not spent taking a city**, and lethality never entered into it — the ambush build made unicorns maul everything on a road and moved that curve not at all.

**Winning fights is not the same as taking cities.** Light cavalry works in Age of Empires because killing villagers is itself a path to victory; here nothing but holding cities is. **This is a victory-condition problem, not a unit problem** — a raider needs a way to hurt an economy (pillaging `c.p` or gold, cutting a road) before it can be worth raising. No amount of pricing or lethality substitutes for it. That is the open design question.

`T.wing` is the compromise that ships: the AI keeps at most that share of its war chest in flyers and spends the rest on something that can knock a wall down, and flyer hosts get first refusal on any enemy column walking a road they touch. At 0.15 it holds — 0 stalemates, 0 games over 24k, win spread 35–50 — and the player actually meets flyers in the world. **Doctrine, not randomness**: a realm raises what its cities breed, so win rates stay attributable instead of dissolving into variance.

**Both of the old known gaps closed when the city stopped fighting** (see "Fights at a city" below), and the note is kept because the *reason* is worth having. Frozen borders and a soft difficulty ladder were the same bug wearing two hats: the garrison term let a token host hold a city against anything, so evenly matched realms deadlocked, and slow behemoth realms — which cannot cash a defensive edge they only get by standing still — were the ones it punished. `diff-test` measured immediately before and after: Duelist **18.0% → 20.5%** against a fair 20%, and the whole ladder steepened — 0 / 18 / 54 / 70.5 became 0 / 20.5 / 59.5 / 77.5. Stalemates went 1-in-400 to 0 on seed 1000, and that range's 34k-tick tail with it.

The ~10% and the per-slot 10 / 25.5 / 14.5 / 18 / 32 % this note used to quote were **already stale** by the time they were cited — a re-measure on the code immediately before this change read 18.0%. Something between round 14 and round 18 had mostly fixed it and nobody re-ran the harness. Treat every number in this file as of its round, and re-measure before building on one.

Kinds refuse to merge, so a node can hold three of your hosts. Two consequences: `spot()` in `render.js` fans them across the owner's slot — sideways, never outward along the spoke, because a host's strength number hangs 18px under its disc and would land on the disc behind it — and the hit test in `main.js` collects every host in range and cycles rather than taking the first.

**The fan counts hosts, not kinds.** It used to key the sideways offset on `a.k`, which put the two halves of a split — same owner, same kind, same node — at exactly the same pixel, one disc and one number hiding the other. `place()` now groups every resting host by `node:owner`, sorts by id and hands `spot()` its place in that group counted from the middle; the node branch spends that as `sp * 26 / r` radians, which is 26px of arc whatever the city's size, so three kinds land where they always did and a split fans the same way. One map of slots serves both branches, so the keys must not collide — a node key carries an `'n'` prefix, or city 5 held by realm 2 would share a key with the road 5–2. Both rules have `dom-test` assertions, and the road key needs no `S.E` lookup: grouping reads a host's own endpoints.

### Stamina

`a.fg` is the one number a host carries that the board cannot say — it is history, not position — so unlike the fog, command and terrain there is nothing to derive it from and it has to be stored. It runs 0–100 like a city's unrest. A host gathers `T.tread` a tick on the march and `T.brawl` a tick in a fight, four times as dear, and sheds `T.rest` a tick standing still. Past `T.wind` it is **winded and marches at half pace** — that is the whole of the mechanic, and it is what stops a warband skipping from city to city forever.

Four things fall out of it rather than being built:

- **No new flag.** The accrual reads `a.eg`, which already means "fought this tick": `roads()` clears it on every host each tick, and every melee and every siege sets it. So a besieger chewing a wall pays the fighting rate with nobody to fight, which is right — and there is nothing to keep in sync.
- **`rate()` is the only place a march speed is computed**, so half pace reaches movement, the renderer's sub-tick interpolation and the AI's `eta()` at once. `eta` used to spell out `T.speed * T.K[a.k][2]`; it calls `rate(a)` now, so `soon()` discounts a prize by what a *winded* host would take to reach it, and it is shorter than the code it replaced.
- **What it really taxes is retreat.** `flee()` never touches fatigue, but a host that turns away at half pace usually fails to break contact — which is why the measured effect is *shorter* games, and not the longer ones every other drag on movement has bought.
- **Reinforcements join the exhaustion.** `mustered()` folds 40 fresh warriors into a host that is already there, and the merge does not dilute `fg`. A brand new host has no `fg` at all until its first tick, which `(a.fg || 0)` covers.

`T.wind` sits deliberately below the 100 cap: a host that has fought itself flat stands ~40 ticks to move freely again and ~100 to be fresh, against 60 to muster a warband. Make the threshold *equal* the cap and one tick of rest un-winds a host — that is the bug this shape avoids, not a spare knob.

**The AI rests, and the gate is in the take-ground loop only** — `if (sits(a.a, f) || tired(a)) continue`. Siege relief and the flyer hunt both read `idle` before it, so an army at the gates outranks a rest exactly as it outranks the unrest pin. Both halves have mutation-checked assertions in `cmd-test` section 13.

**Split halves inherit fatigue** (`fg: a.fg` in `split`), or a winded host would launder itself into two rested ones for nothing.

**The ring is the whole UI.** `render.js` draws an arc at r=15 around a host filling as `a.fg / 100` — amber `#ffd76a99` while it gathers, `#ff9a3c` on the tick the host is winded — which is the same amber a mustering city wears, because it says the same kind of thing: a clock you are waiting on. A fresh host draws nothing, so the board only carries the ring where it has something to say; the exact number is the warband card's, below. It is drawn for every host the player can *see*, enemies included: fatigue is intel that comes with sight, like the strength number under the disc, and it inherits the fog for free by sitting inside the `seeArmy` loop.

**Fatigue is deliberately absent from the two open-field speed layers.** `might` and `strike` read `T.K[a.k][2]` straight from the table, so a winded unicorn still ambushes like a fresh one. That is a knowing inconsistency — speed is a combat stat in the open, and stamina halves speed — and it is left alone because it is a far bigger balance change than the march rule. It is one factor in `might` if road fights ever want it, with a full re-run.

**What it bought, measured** (400 games × three seed ranges at rung 2, `diff-test` at 200 a rung; *before* is the same tree with `T.tread` and `T.brawl` at zero, which is an exact no-op — it reproduced round 21's seed-1000 figures to the tick, which is what makes it a control rather than a second opinion). Games get **shorter** in every range, which was not the expected direction:

| seed | p50 | p90 | p99 | max | stalemate |
|---|---|---|---|---|---|
| 1000 | 4311→**3993** | 7558→7540 | 12904→13874 | 14920→17777 | 0→**1** |
| 5000 | 4355→**4075** | 8229→7576 | 14009→13733 | 25163→23902 | 0→0 |
| 9000 | 4407→**4049** | 7385→6690 | 13785→**10942** | 18833→15009 | 0→0 |

Win spread tightened where there is a control to compare against (seed 1000, 58–105 → 63–92 of 400 against a fair 80; the other ranges land 70–85 and 64–97). `diff-test` went 0 / 18.0 / 65.0 / 79.5 → 0 / **21.0** / 60.5 / 80.5 — still monotonic, and the fair Duelist rung back on 20% from under it.

**The one stalemate is worth reading before treating it as a fatigue problem.** It is game 181 of seed 1000, realms 0 and 3 frozen at 13 cities against 7, and at tick 120,000 **every host on the board is at `fg` 0**, parked, with the whole map settled at 0 unrest and realm 3 sitting on an 821-warrior stack nobody will attack. It is the old frozen border — the AI's own attack gate refusing a fight — reached by a different route, not armies too tired to move. 1 in 1,200 games, against p50 down 7–8% in all three ranges.

It cost ~90 B zipped, which is inside the noise of Roadroller's own run-to-run spread either side of it.

### Fights at a city, and sieges

**A city never joins a fight between hosts.** `melee` takes one argument now; the garrison term it used to take (`c.d * 0.5` per tick, aimed at a random enemy of the owner) is gone. Two hosts standing on a city trade as they would on the road outside it, less the two speed layers and plus home ground — `afield(g)` is `g[0].t >= 0` and `at(i)` only returns resters, so `might` and `strike` carry no speed at a node. That part needed no code; the garrison term was the whole of it.

The old term was not a small thumb on the scale. With `T.atk = 0.06 * P` and `c.d` drawn `ri(2, 10)` in `genMap`, 40 footmen at a Defense-5 city put out 0.24 bodies a tick and the city put out **2.50** — the walls were doing 91% of the killing, and the defender's *kind* barely registered: 40 unicorns (0.6 field power) held a city exactly as well as 40 behemoths (2.2), both to about 120 attacking behemoths. Kind matters at a city now, which is the point of the change.

**A siege is what happens when there is nobody left to fight**, and it is the only thing `c.d` still powers — across its whole `ri(2, 10)` range it costs a besieging host 4% to 20% of its bodies, while wall points set the clock (40% walls fall in 40 ticks, full walls in 104). Defense is an attrition tax; `c.s` is the gate. The node branch runs a melee and `continue`s while two owners have hosts present, so walls take nothing until one side is gone; then `T.sgLoss * c.d` is charged per tick against the besiegers and `ram * T.sgDmg` against the wall. `cmd-test` section 10 pins all three rules — Defense-2 and Defense-10 leave a *byte-identical* node fight, a stouter city bleeds besiegers harder, and a defended city takes no wall damage — and all three are mutation-checked.

**What it bought, measured** (400 games, two seed ranges; and `diff-test` run either side). p50 barely moved (4161→4304, 4049→4195) but the tail collapsed: seed 1000 went p99 20455→10187, max 34159→22283, 3 games over 24k → **0**, and its one stalemate → **0**. Seed 5000's win spread tightened to 75–89 against 80 expected. It also freed **79 B**, because the garrison branch and its `foesOf` helper went with it.

**Why the tail was there.** A defended city was nearly unkillable, so two evenly matched realms could hold a border forever. Every frozen-border artifact this repo has recorded traces back to that one term.

**The one thing no harness could see at the time.** `sim-test` and `diff-test` are all-AI, and back then the AI never garrisoned deliberately — so the garrison term was a tool only a *human* was using. (It garrisons now; see "The AI garrisons" below. That does not bring the term back — the AI parks boots on a city to hold its *people* down, and boots are still all a city contributes to a fight.) Removing it takes away the player's "leave forty men and the city holds" move and takes nothing from the AI. Every number above is blind to that. If defending starts to feel hopeless, this is the change to look at, and the fix is a rung or a `T` knob, not putting the term back — `T.home` below is the first instalment of exactly that, and it is a knob for the same reason.

**Home ground is the one thing a city still lends its own men: `T.home`, 1.2 on attack.** A host fighting at a city of its own realm swings 20% harder — it knows the streets and the wells. It rides in `might`, in the slot the speed layers vacate at a node:

    const might = (a, o) => pw(a) * (o ? (1 + T.K[a.k][2]) / 2 : S.C[a.a].o === a.o ? T.home : 1)

Three properties are deliberate. It is **derived from the board** like the fog — the ground is home or it is not, there is no defender flag to set on arrival or clear on capture, and a city changing hands changes who fights harder on it that same tick. It is an **attack term only**: damage in `melee` comes off `a.w`, so home ground buys output and never durability, and the enemy still needs the same number of blows to kill you. And putting it in `might` rather than in `melee` means `odds()` sees it too, so the AI's rout check values a host on its own soil the way the melee will actually resolve it — one term, no second call site.

It is gated by the same `o` that gates speed, so **a road fight is untouched**: the realm that owns the cities at either end of a road is worth nothing on it. Both halves have mutation-checked assertions in `cmd-test` section 11, and the road half matters — moving the factor outside the `o` ternary passes the node tests and breaks that one.

**What home ground bought, measured** (400 games × three seed ranges at rung 2, plus a rung-1 range and `diff-test` either side; before is the same code with `T.home` at 1.0). The core does not move — p50 4304→4238, 4195→4212, 4184→4183 — and the tail comes in slightly: seed 1000 max 22283→**13936**, seed 9000 max 30598→**18376** and its one game over 24k → **0**. p90/p99 wobble either way by less than the spread between ranges. Stalemates stayed 0 across all three. `diff-test` at 200 a rung stays monotonic: 0 / 20.5 / 59.5 / 77.5 → 0 / **15.5** / 57.0 / 76.0.

**The two win-share scares in that run cancelled, and how they were resolved is the reusable part.** Realm slot 0 rose in all three rung-2 ranges (257→302 of 1200, 21.4% → 25.2% against a fair 20% — on its own a 4σ story), while `diff-test`'s fair Duelist rung fell the *opposite* way, 20.5% → 15.5%. A fourth range settled it: at rung 1 on seed 3000, realm 0 went 84→76 of 400 and the whole spread *tightened*, 70–84 → 75–90. Two of the three signals say slot 0 lost a little and one says it gained a lot, so there is no bias here to attribute — which is exactly the trap this file warns about, and a single range would have "proved" either answer.

**What was left alone on purpose.** `force()` and `friend()` in `ai.js` still weigh hosts with bare `pw`, so the AI slightly under-rates a defender standing on its own city when it picks a target. Teaching them `T.home` is a one-word change to the highest-risk file in the repo, and the ladder above did not ask for it. If a defended city starts looking too attractive to the AI, that is the knob — with a full balance re-run.

### Crumbling is gone, and the AI can see the whole board

Round 30 deleted crumbling entirely — `T.starve` first (its own section below), then `T.rot` and the whole of step 6b. A realm down to its last cities keeps every wall point and every warrior it has. `T.dying` survives for **one** thing, the `rally` gate in step 5c, and that one is not optional: retiring it as well was measured in the same round and is catastrophic (p50 ~2.4x, 19–21% of games past 24k ticks, against 0–1%).

**Removing the rot did not make dying realms fail on their own. It exposed why they never did.** Three all-AI stalemates were traced rather than assumed, and none of them was a wall that would not fall. Seed 9241 ends with realm 1 on one city — Mirgate, defence 10, **walls 78 of 78, not besieged** — while realm 4 holds nineteen cities, **147,107 gold**, and fifteen hosts including stacks of 698, 760, 720, 720 and 640 warriors, every one of them parked inland. The conqueror was not failing to breach the last city and was not declining a bad fight. **Not one of its hosts was adjacent to the city, and it had no way to become adjacent.**

`step()` scored `S.C[a.a].n` — the cities next door to wherever a host already stood — and the only thing pulling a host forward was the friendly-drift term, which scores a city **only if that city borders an enemy**. So a host two or more hops behind the front scored 0 on every option it could see, `best` stayed `-1`, and it never moved again for the rest of the game. The rot had been hiding this for as long as it existed, by dissolving the cities the armies could not reach.

**The fix is the candidate list, not a new heuristic.** `order()` already multi-hops through `hop()`, and `soon()` already discounts a prize by the walk — both halves were there:

    for (let j = 0; j < NC; j++) {
      if (j === a.a) continue

Every city on the board is now a candidate for every idle host, priced by distance exactly as adjacent ones always were. Nothing else in `step()` changed: the attack gate, the scores, `sits`, `tired`, the flyer hunt and siege relief are all untouched. It cost **8 B**.

**What the AI fix bought, measured** (400 games × five seed ranges at rung 2; *before* is the same tree with the one-hop loop restored, so this isolates the AI change from the crumbling removal):

| seed | p50 | p90 | p99 | max | >24k |
|---|---|---|---|---|---|
| 1000 | 4247→**3840** | 7577→**6166** | 19857→**10660** | 81482→**12676** | 4→**0** |
| 5000 | 4209→**3861** | 7085→**5958** | 19224→**11868** | 66617→**14903** | 3→**0** |
| 9000 | 4210→**4007** | 6820→**6207** | 13992→**10680** | 24047→**11988** | 2→**0** |
| 3000 | 4325→**3998** | 7449→**6285** | 15320→**10687** | 47100→**12832** | 3→**0** |
| 13000 | 4341→**4152** | 7046→**6467** | 14327→**10556** | 46132→**12858** | 3→**0** |

Every column, every range. **0 stalemates and 0 games over 24k ticks in 2,000 games**, against 15 over-24k games and 3 stalemates for the same tree one hop short. The `max` column is the tell: the worst war on the board went from 81,482 ticks to 12,676, and p99 lands within 10,556–11,868 across all five ranges where it used to scatter from 14k to 20k. An army that can find the front ends wars; the spread between seeds is now mostly the map.

**And against the tree that shipped before this round** — crumbling intact, AI one-hop — the whole round is roughly free at the core and much tighter in the tail:

| seed | p50 | p90 | p99 | max | stalemate |
|---|---|---|---|---|---|
| 1000 | 3849→3840 | 6702→6166 | 10703→10660 | 27967→**12676** | 0→0 |
| 5000 | 3885→3861 | 6278→5958 | 10641→11868 | 11713→14903 | 0→0 |
| 9000 | 3750→4007 | 6162→6207 | 11469→10680 | 20905→**11988** | **1→0** |
| 3000 | 3941→3998 | 6437→6285 | 9286→10687 | 16013→12832 | 0→0 |
| 13000 | 4015→4152 | 6520→6467 | 9332→10556 | 10398→12858 | **1→0** |

p50 within ±4% everywhere, p99 up a little on three ranges and down on two, and **no game anywhere near the old tails**. Win share tightened as well: summed over 2,000 games the realm slots go 427 / 357 / 400 / 390 / 424 → **393 / 369 / 405 / 411 / 422** against a fair 400, the narrowest spread this file has recorded.

**The one real cost is the middle of the difficulty ladder, and the reason is worth keeping.** `diff-test` at 200 a rung: 0 / 19.5 / 65.0 / 76.5 → **0 / 19.5 / 57.0 / 77.0**. Still monotonic, and the fair Duelist rung lands exactly on 20% — but Warlord sheds 8 points while Tyrant does not.

It is **not** that opponents got better at fighting back; that was the first guess and it is wrong. A probe counting idle hosts that found no target at all (60 games a rung) shows the one-hop horizon was taxing the *high* rungs hardest, because a rung buys army cap and a bigger army overflows a one-city-deep frontier:

| rung | stranded, the rung itself | stranded, its four Duelist opponents | after the fix |
|---|---|---|---|
| Duelist | 23.5% | 25.6% | 0.4% |
| Warlord | **61.4%** | 22.0% | 0.6% |
| Tyrant | **65.9%** | 20.5% | 0.9% |

So part of what the top rungs were being sold was armies that would never reach a fight. The fix turns those into *marching* armies — and a marching host is not idle, so there is nobody left for an extra `act` to order. `D[].acts` only pays while you have an idle host to spend it on. Orders issued per turn against one Duelist opponent: Warlord **2.73x → 2.43x**, Tyrant **3.28x → 3.77x**, which is the direction both win shares moved. Warlord sits on the crossover; Tyrant's three acts and 1.9x cap still keep a third order fed. Warlord's own throughput fell 28% (5,986 → 4,339 orders) against its opponents' 18%, which is what rules out the catching-up story.

A second contributor is **unseparated**: low-rung wars roughly halved (Duelist-vs-Duelist p50 10,820 → 6,047), and Warlord's edge is partly 1.6x income, which needs time to compound, where Tyrant's 2.3x bites sooner. Telling the two apart needs its own run. If Warlord needs its edge back, `D[].acts` is the first knob and `D[].cap` the second, each with a 200-game `diff-test` re-run.

**What was deliberately not touched.** `force()` and `friend()` still weigh hosts with bare `pw`, ignoring `T.home`; the attack gate's `1.3` and `1.6` coefficients are unchanged; and the AI still never splits a host. The one-hop horizon was the whole of the passivity, and nothing else in `ai.js` needed a hand to prove it.

`cmd-test` section 14 is now positive assertions, because the ones it replaced all keyed on the rot existing and would have gone vacuous the moment it left: a realm at `T.dying` **keeps every wall point it had**, its army **never starves**, and a siege of its city runs to the **identical tick** as the same city held by a realm owning everything. Mutation-checked both ways — restoring the rot fails it, restoring `T.starve` fails it.

### The wall rot that used to be, and why the floor mattered

**Removed in round 30 — see the section below.** `T.rot` in step 6b shed wall points from every city of a realm down to `T.dying` or fewer. It used to floor at **0.5**, and that floor was a bug with a very specific shape: **capture is `c.s <= 0` in the siege step**, so a floor above zero is a floor under the whole endgame.

The floor **reset the wall every tick**, which meant a besieger had to cross the whole of it in a single tick or never cross it at all. A standard muster — `T.raiseW` 40 footmen — rams `40 * T.sgDmg` = **0.33** wall points a tick, under 0.5. So the wall sat at exactly 0.5 for ever while the host bled out against it at `T.sgLoss * c.d` a tick. Traced on seed 7 against a Defense-10 city: walls 42 → 0.5 by tick 200, host 40 → 0 warriors by tick 500, city never taken in 3,000 ticks.

**And the player could see none of it**, which is what made it a bug report rather than a balance note: the panel prints `c.s | 0` and the wall ring draws `max(0, c.s) / c.m`, so a city pinned at 0.5 reads **"Walls 0"**. The symptom is a zero-walled city that eats army after army, and it fires at the worst possible moment — mopping up the last realm, which is the only time 6b runs at all.

The threshold was `ram > 60` early on, easing to ~43 by tick 20,000 as `T.escal` bites. So: 40 footmen never, 40 unicorns never (ram 20), 40 behemoths fine (ram 100), 80 footmen fine. Worse, a 61-footman host **bled below the line mid-siege** and then stalled for ever, so the trap was not even monotonic in what you sent.

**Measured across five independent seed ranges, 400 games each at rung 2** (`diff-test` at 200 a rung either side). Three ranges were run first and looked alarming — seed 1000 grew a 27,967-tick game and seed 9000 a stalemate — so two more were run before drawing any conclusion, which is the procedure this file keeps insisting on:

| seed | p50 | p90 | p99 | max | stalemate |
|---|---|---|---|---|---|
| 1000 | 3922→3849 | 6383→6702 | 11936→**10703** | 17887→27967 | 0→0 |
| 5000 | 3982→3885 | 6086→6278 | 9618→10641 | 11292→11713 | 0→0 |
| 9000 | 3941→**3750** | 6568→**6162** | 13596→**11469** | 16020→20905 | 0→1 |
| 3000 | 3834→3941 | 6588→6437 | 10768→**9286** | 15260→16013 | 0→0 |
| 13000 | 3896→4015 | 6193→6520 | 10510→**9332** | 15232→**10398** | 1→1 |

Read it as: **p99 comes in on four ranges of five**, p50 moves by less than the spread between ranges, and the stalemate and 24k counts (1→2 games in 2,000) are inside the noise the *unfixed* code already produces — seed 13000 had a stalemate before the change. `diff-test` improved: 0.5 / 23.0 / 65.0 / 76.0 → 0 / **19.5** / 65.0 / 76.5, the fair Duelist rung landing back on 20%.

### A crumbling realm no longer starves, and what the `| 0` hides

Step 6b used to melt a crumbling realm's **armies** alongside its walls: `T.starve` (`0.02 * P`, 0.2% of every host per tick) applied to every host of a realm at or below `T.dying`. It is gone, tunable and all, and the trailing `S.A.filter(a => a.w > 0.5)` went with it — nothing between the siege step's own cull and 6b touches `a.w` any more, so that filter was dead the moment the starve line left.

**Why it went.** A dying realm gets chased down by the armies already on the board; starvation only took that job off them. And it read as a bug from the player's side. The strength number is `a.w | 0` in `render.js` and in the warband card — it **truncates** — so a host of one warrior printed `0` on the *first* starved tick and stayed alive, unhurt and reading as nothing for 346 ticks more before the 0.5 cull took it. That is the same shape as the "Walls 0" bug one section up: a truncated readout saying *gone* about something the sim still counts. The report that found it was a player splitting 40 warriors into forty singles at their last city; all forty printed 0 on the same tick, with no battle anywhere.

**The split was also a real loss, not just a misleading one**, because the cull is per host: starving from 40 as one host lasted to tick **2,189**, as forty singles to tick **347**.

**Measured** (400 games × five seed ranges at rung 2, `diff-test` at 200 a rung; *before* is the shipped tree, which reproduced this file's round-29 figures to the tick). Three ranges were run first and two of them grew an alarming `max`, so two more were run before concluding — the same procedure the wall-rot round used, and it reached the same verdict:

| seed | p50 | p90 | p99 | max | stalemate | >24k |
|---|---|---|---|---|---|---|
| 1000 | 3849→4156 | 6702→**6487** | 10703→12909 | 27967→41693 | 0→1 | 1→2 |
| 5000 | 3885→4225 | 6278→7152 | 10641→13485 | 11713→16419 | 0→0 | 0→0 |
| 9000 | 3750→3925 | 6162→6875 | 11469→13094 | 20905→34694 | **1→0** | 1→1 |
| 3000 | 3941→4022 | 6437→6767 | 9286→12242 | 16013→20940 | 0→0 | 0→0 |
| 13000 | 4015→4104 | 6520→6645 | 9332→10699 | 10398→**16820** | **1→0** | **1→0** |

Read it as: **p50 is up 2–9% in every range** (~5% on aggregate) and **p99 up 14–32% in every range**, which is the price and it is consistent. The `max` column is the one that looks frightening and is not: across 2,000 games a side the stalemate count went **2 → 1** and the games over 24k ticks **3 → 3**. No new class of unending game appeared; the same handful of long wars simply ran longer. `diff-test` stays monotonic — 0 / 19.5 / 65.0 / 76.5 → 0 / **22.5** / 64.0 / 77.0 — with the fair Duelist rung a little over 20% rather than under it.

Win share widened a little: summed over all five ranges, realm slots went 427 / 357 / 400 / 390 / 424 → 422 / 332 / 440 / 405 / 400 against a fair 400. That is slot 1 down 25 and slot 2 up 40 in 2,000 games, which is the size of swing this file has twice recorded as unattributable from five ranges. Do not act on it without a sixth.

It gave back **~15 B** (13,229 → 13,214 zipped, 98 B of headroom), which is inside Roadroller's own run-to-run spread.

**What is still true, and is the next thing to look at if it bites.** `a.w | 0` still truncates, so any host taken below 1 warrior by *combat* reads 0 while it fights on. It is far rarer now that nothing drives a host down by fractions of a body a tick, and it was left alone rather than fixed blind: `Math.ceil` at the two print sites would cost ~10–15 B and would change what **every** host on the board reads (39.92 would print 40, not 39), which is a bigger change than the bug. Nothing tells the player their realm has started to crumble, either.

`cmd-test` section 14 pins three things — a crumbling realm's walls reach **exactly 0**, one standard muster carries such a city (tick 142 on seed 7), and a *healthy* realm holds the same city longer (tick 201), so the rot is still a real weakening and not merely the removal of a floor. Three mutations were tried: the 0.5 floor restored, a floor of just **0.01**, and the rot deleted. All three fail it.

### Road contact, and the flee toll

Two bugs lived here together and fed each other. Both have regression tests in `road-test.mjs`, mutation-checked.

**The chain finds the brawl; it must not decide who is in it.** Clustering grows while *consecutive* gaps are `<= T.reach`, so six hosts spaced 18 apart chained into one cluster spanning **95 units** and the rearmost was locked into a melee 5.3x reach away from any enemy. Membership is now: within `T.reach` of an enemy, plus friends within `T.reach` of one of those. Arrivals still join, because the movement walk halts a host `T.reach * 0.9` behind its own front rank. Span is bounded at roughly `2 * T.reach` either side of contact instead of unbounded.

**`T.flee` is charged once, not once a tick.** The AI re-flees every tick it is losing, and `flee()` called `turn()` each time — so a host flipped orientation every tick, netted nearly zero displacement, and paid a quarter of itself per tick until it died. Measured: 20 warriors down to 4 in seven ticks, 95 units from an enemy it never touched, while that enemy lost 2 of 400. `flee(a, ep)` now takes where the enemy is: still ahead means a real disengagement and costs `T.flee`; already behind means the host is mid-retreat and just keeps walking (`st = 0`). The player's own retreat through `order()` passes no `ep` and always pays, which is right — it is one deliberate act, and `turn()` swaps the endpoints so a second click is a march order, not a second toll.

**What fixing it cost, measured.** The bug had been *inflating* the value of road combat: losing hosts dissolved on the spot instead of retreating, so every skirmish was decisive. With retreats surviving, 300 games a range gives p50 4233/4020 and p90 7152/6732 — the core is unmoved — but seed 1000 gained **1 stalemate and 2 games over 24k** (game 77, realms 0 and 1 frozen at 11 cities against 9), and that game was inside the previously-clean 200-game sample, so the fix caused it. Two evenly matched realms can now grind without either army ever breaking. The unicorn realms also lost ground (600 games: behemoth realms 147/126, unicorn realms 100/104/122 against 120 expected) because an ambush that no longer annihilates its victim is worth less. Both are accepted: a host that retreats should not dissolve, and the alternative is a mechanic that lies to the player.

### Civil unrest

Each city carries one number, `u` (0–100), plus `na`, the realm it was drafted into. `u` is nothing at all while `na` holds the city; the moment anyone else takes it, `u` jumps to `T.seize` (never downward — a second captor inherits whatever the first earned). It then moves on its own slow clock, `T.slow` ticks apart, which is the only place in `tick()` that is not per-tick.

Per check, a conquered city gathers `T.stir` and its occupier puts down `T.pace` *scaled by strength against population* (`min(1, warriors / (pop × T.hold))` — without that scaling one warrior held a city as well as two hundred, and splitting one off cost nothing). Past `T.calm` the city will not conscript and flies ✊; past `T.riot` it may `revolt()` on any check, which simply hands the city back to `na` at full walls — no mob, no siege, no army spawned.

**`T.stir` is 4.4 * P — double what it was — and `T.pace` was left alone.** That is deliberately *not* the same change as speeding up the clock: `T.slow` stays at 10, so the cycle runs at its old cadence and only the rise doubled. Two consequences, both intended. A neglected conquest now climbs `T.seize` 70 → `T.riot` 90 in **460 ticks instead of 910**, about a ninth of a p50 game rather than a fifth, so revolts are something you see rather than something the numbers promise. And **a garrison must be twice as strong to break even**: `sat` has to clear `stir / pace` = 0.55 of `c.p * T.hold`, where 0.275 used to do — 17 warriors on a populace of 120, not 9. Half a full-weight garrison now watches the city boil. Both have mutation-checked assertions in `cmd-test` section 8; halving `stir` back fails them.

The alternative considered and rejected was halving `T.slow` to 5, which doubles stir *and* pace per unit time and leaves the break-even garrison exactly where it was. It measured better (it is a pure time-compression) but it is not what was wanted: token garrisons were supposed to stop working.

**What it cost, measured** (400 games × three seed ranges at rung 2, `diff-test` either side). The tail paid for it, consistently and in every range — revolts hand border cities back, so neither realm consolidates and the war drags:

| seed | p50 | p90 | p99 | max |
|---|---|---|---|---|
| 1000 | 4073→4235 | 6633→6789 | 11867→13427 | 15139→20844 |
| 5000 | 3948→4068 | 6158→7177 | 8919→12086 | 11426→15961 |
| 9000 | 4084→4210 | 6859→7287 | 10741→11611 | 13255→18516 |

Seed 5000 also picked up **1 stalemate and 1 game over 24k** (game 95, realms 3 and 4 frozen at 12 cities against 8 — a border that keeps flipping, not a rump being fed). `diff-test` holds its shape, 0 / 20.5 / 61.5 / 80.5 → 0 / 20.5 / 60.5 / 80.0, with the fair rung still on 20.5% and its p50 stretched 8270 → 10118. Win spread actually *tightened* across the three ranges, 211–283 → 208–265 of 1200. This is roughly the same trade the flee fix took in round 17, and it is accepted for the same reason: the mechanic is the point. If the tail needs paying back, `T.rise` (riots fire sooner once past the line) and `T.pace` are the knobs, in that order — not `T.stir`.

**The harnesses were half-blind to this at first, which is what forced the next change.** The numbers above were measured against an AI that never garrisoned, so the doubled `stir` reached it only as revolts — and it had no answer at all, because the take-ground loop marched every host straight back out of a city it had just taken. That is what "The AI garrisons" below fixes, and the tail figures in this table are superseded by the ones there. `D[].pac` (0.6 / 1 / 1.15 / 1.62) multiplies `sat`, so it is the rung knob for how hard holding a conquest is, and the player is always `D[1]`.

**The AI garrisons.** This is the one claim in this file that round 21 reversed, and it was reversed on evidence: doubling `T.stir` handed the AI a way to lose cities that it had no answer to. After a capture the take-ground loop marched the host straight back out — every neighbour scores something, so a fresh conquest was never held — and the city climbed to `T.riot` and went home. Two reads of one quantity in `ai.js` fix it, and `garrison` is now exported from `sim.js` for them:

    const held = (i, f) => garrison(i, f) * T.pace * S.F[f].dm.pac >= S.C[i].p * T.hold * T.stir
    const sits = (i, f) => S.C[i].o === f && S.C[i].u > T.seize && held(i, f)

`held` is the pacify side of the unrest check beating the stir side — literally the sum `tick()` does, minus the `sat` clamp, and it reads `S.F[f].dm.pac` so each rung judges its own grip. Then: **a host that is the reason a conquest is quiet does not march** (`if (sits(a.a, f)) continue`, at the top of the take-ground loop), and **an idle host is drawn to a conquest nobody is holding** (`if (c.u > T.calm && !held(j, f)) s += 5`, in the friendly branch of the score).

Three details carry weight. The `held` test inside `sits` is what stops a host being pinned to a city it could never hold — 100 warriors on a populace of 4,000 walk on instead of sitting there uselessly, and `cmd-test` section 12 fails if that term is dropped. Siege relief and the flyer hunt read `idle` *before* the pin and so still override it, because an army at the gates outranks a restless populace. And the release is `u > T.seize`, not `u > T.calm`: **the looser pin was measured and is worse.** Releasing at `T.calm` lets the host go after a check or two, and across three ranges that gave 1 / 1 / 0 stalemates against the tight pin's 0 / 0 / 0 — including the *same* game 95 on seed 5000 (realms 3 and 4 frozen at 12 cities against 8) that doubling `stir` had introduced. The tight pin is what breaks that deadlock; the loose one watches it happen.

**What it bought, measured** (400 games × three seed ranges at rung 2, against the doubled `stir` with no garrisoning):

| seed | p50 | p90 | p99 | max | stalemate |
|---|---|---|---|---|---|
| 1000 | 4235→4311 | 6789→7558 | 13427→12904 | 20844→**14920** | 0→0 |
| 5000 | 4068→4355 | 7177→8229 | 12086→14009 | 15961→25163 | **1→0** |
| 9000 | 4210→4407 | 7287→7385 | 11611→13785 | 18516→18833 | 0→0 |

Read that honestly: it buys **consolidation**, not speed. Stalemates go to zero and seed 1000's worst game drops from 20.8k to 14.9k, but armies are tied down holding ground, so p50 rises 2–5% in every range and seed 5000 grew one 25k game. `diff-test` went 0 / 20.5 / 60.5 / 80.0 → 0 / **18.0** / 65.0 / 79.5 — still monotonic, fair rung a little under 20%. Against the state before the whole unrest round, games are ~5–8% longer with a fatter p99: that is the price of the mechanic, paid deliberately.

**It cost ~60 B and headroom is now ~50 B.** The next feature will have to find bytes elsewhere. If they are needed here, `S.F[f].dm.pac` is the first thing to drop from `held` — the AI would then judge every rung by Duelist's pacify rate, which is wrong but cheap.

The sign of `T.stir` is load-bearing: a native realm down to `T.dying` cities or fewer *rallies nobody*, so its lost cities calm instead of stirring and no revolt fires for it. Without that, revolts keep handing a crumbling rump fresh cities, it never falls below `T.dying`, and the game will not end — that showed up as a single 57k-tick game in a 400-game run while the p50 barely moved.

### Conscription

**The populace the panel shows is the populace you can conscript.** `canRaise` has no floor beyond the muster's own price: `c.p >= T.K[k][4]`, and `T.minPop` (a flat 55) is gone. A city drawn at `ri(40, 200)` in `genMap` can therefore raise from the first tick instead of waiting to grow past 55, and a city can be drafted down to almost nobody — 👥200 yields five footmen musters and leaves 6 behind. What stops you is gold and `T.muster`, not a reserve the city insists on keeping.

Nothing else in the sim reads `c.p` as a threshold, which is why this was a two-line change: **income is `c.e`, not population** (`e * T.inc` per tick), pop regrows toward `100 + c.e * 10` at `T.grow` regardless of how low it went, and the one other place `c.p` appears is the unrest hold, `min(1, garrison / (c.p * T.hold))` — where a drained city is *easier* to hold, not harder. The AI's target score reads `c.p / 60`, so it also values a stripped city less. `cmd-test` section 9 pins the new gate exactly on the price, one body either side of it, and drains a city to prove there is no floor left; putting any floor back fails four assertions.

**What it bought, measured** (400 games × three seed ranges at rung 2, `diff-test` either side; before is the commit immediately prior). Games get shorter and the tail comes in, because armies are available when the gold is:

| seed | p50 | p90 | p99 | max |
|---|---|---|---|---|
| 1000 | 4238→4073 | 7094→6633 | 12064→11867 | 13936→15139 |
| 5000 | 4212→**3948** | 6788→**6158** | 11174→**8919** | 18638→**11426** |
| 9000 | 4183→4084 | 7054→6859 | 10357→10741 | 18376→**13255** |

0 stalemates and 0 games over 24k on all six runs. Win spread tightened in every range (61–112 → 66–102, 67–93 → 72–89, 63–97 → 62–95), and realm slot 0's rung-2 excess — the one the home-ground round could not attribute — came down with it, 302 → 283 of 1200. **`diff-test` got both fairer and steeper: 0 / 15.5 / 57.0 / 76.0 → 0 / 20.5 / 61.5 / 80.5**, the fair Duelist rung landing back on 20%. Removing the floor also saved ~11 B, which is inside the build's own noise.

### Audio

`src/player.js` is SoundBox's `player-small.js`, altered in exactly two ways — `CPlayer` exported as a module binding, and the unused `getData()` deleted. zlib licence: keep the copyright header, and if you alter it further, say so in the ALTERED SOURCE notice at the top. Arpeggio was dead code for a while and kept anyway on the bet that a sound effect would want it; the sword clash does (`ARP_CHORD 1`, `ARP_SPEED 7`), so it is live now.

`src/audio.js` grinds one instrument per frame from the render loop so the boot doesn't stall, and starts playback on realm selection, which is also the user gesture browsers require for autoplay. A `typeof Audio` guard keeps the headless harnesses out of it. The player's noise oscillator uses `Math.random()`, so **generated audio differs every run** — don't try to assert byte-identical output.

`TRK` is the grind queue in fixed order — **0 song · 1 horn · 2 chime · 3 fanfare · 4 clash** — and `bank[]` is the rendered result at the same indices. The song is first because the title screen is what waits on it; the four effects (`src/sfx.js`, one instrument over one 32-row pattern each) cost one extra frame apiece after it. Two tracks loop and are reconciled by `play()`: the song, and the din of battle. The rest are fired by `shot()`, which rewinds only an element that has actually played — the `currentTime` setter used to throw on a pre-metadata element in older WebKit.

The chime is on every button that commits to something (`'rgxfdv'.includes(a)` in `ui.js` — raise, specialist raise, split, mend, rung, speed) and on every map click that lands: a city, a host, or a destination for a host under command. **The realm card is the one deliberate exception** — `music(1)` fires on the same click and the song comes up over the chime, so it was inaudible and was removed. There is a test that fails if someone adds `s` back to that string.

**The din of battle is derived, like the fog.** `main.js` runs `clash(playing && !S.over && S.speed > 0 && fighting())` every frame. The `S.speed` term is the pause: `S.speed === 0` is the whole of pausing, the ticks stop, and a paused board is a still picture — the clash marker stays drawn but the fight it records is not happening, so the loop has to stop with it and start again on unpausing. `dom-test` samples that on a live fight using frames of no elapsed time, so the assertion costs the sim nothing. `fighting()` in `sim.js` is two terms, and both are needed:

- `S.fx.some(f => f.k === 1)` — a clash marker on screen. This inherits the fog for free, because `sim.js` never pushed the marker for a fight the player cannot see.
- `S.C.some((c, i) => besieged(i) && seeCity(i))` — **a siege has nobody to fight, so it draws no ⚔️ of its own.** `melee` only fires when `sides.length > 1`; a lone besieger chewing a wall would otherwise be silent. The `seeCity` half is not decoration — drop it and a siege inside the fog starts making noise, which `dom-test` catches.

There is no "am I fighting" flag to keep in sync, and reintroducing one is the same regression as reintroducing a stored fog bit.

**A backgrounded tab is the one state change the render loop cannot deliver.** Every other thing `play()` reconciles arrives from a frame — and a hidden tab gets no frames, so the song and the din simply played on over whatever the player had switched to. Reported on iOS Safari and just as loud on Android:

    if (can) document.addEventListener('visibilitychange', () => { hid = document.hidden; play() })

**It goes on the `document`, and the first version of this shipped on the `window` and did not work** — tested on Android Chrome, music still playing. Every other listener in this codebase is a window listener, which is why it went there by habit. The lesson is in the harness, not the fix: `dom-test` stubbed `addEventListener` into **one bag shared by window and document**, so it fired whatever it had been handed and passed either way. It was a test of the assumption rather than of the target. The two registries are separate now, in `dom-test` **and** `dist-test`, and putting the listener back on the window fails both.

That is also the first time `dist-test`'s document stub has had to grow: the packed bundle is the only place the *target* can be checked at all, and it now asserts `doc.h.visibilitychange` exists and that firing it pauses the song through the mangled `play()`.

`hid` is a **third term in the reconcile**, not a pause of its own, and that distinction is the whole of the correctness. `mute()` calls `play()`, so an implementation that paused the elements on the way out and called `play()` on the way back would start the song again the moment a player toggled mute while away — playing to a tab nobody is looking at. `dom-test` pins exactly that case, because the obvious assertions (does it pause, does it come back) pass under both. Three mutations are checked: no listener at all, pausing directly instead of rejoining the reconcile, and the song handled without the din.

The **simulation** needs nothing: `frame()` clamps `dt` to 0.1 s and caps catch-up at 8 ticks, so a tab that comes back after ten minutes resumes where it left off instead of fast-forwarding the war. The assertions spend no frames and no ticks — they fire the handler directly on the fight the din tests already have running, which is what keeps them from disturbing the sections after.

**The effects are the only audio the harnesses cover, and they are covered properly.** `dom-test` stubs `Audio` alone — Node has `Blob` and `URL.createObjectURL` — so all five tracks are ground for real and a broken instrument row throws there rather than in the browser. Every one of those assertions is mutation-checked. Note that a natural `dom-test` run reaches exactly one of the two endings, which made the fanfare check half vacuous; the forced win at the end of the file is what makes it a test.

`sfx.js` spells the three tonal instruments out in full even though they differ in four slots. Folding them into a shared array plus patches cost **20 B more**, because Roadroller models the near-identical rows better than the patch loop compresses. Measured; don't redo it.

### The UI is deliberately thin

Almost everything a panel might report is already on the map: ownership is the ring colour, a host's strength is the number under it, the wall ring around a city is `c.s / c.m`, and a march is its dashed path to a lit destination. The city panel carries what the map does not, and so — since round 22 — does the warband card. Before adding a readout, check the map does not already say it.

**The raise badge is derived too.** `render.js` draws `⬆️` at the lower-left of a city's disc — mirroring the specialist glyph at its lower-right — whenever `canRaise(i, S.me) || (c.sp && canRaise(i, S.me, c.sp))`, so a city that breeds something still shows it when only the specialist is affordable. It reads the live predicate rather than any stored flag, which means it comes and goes with your gold, and `canRaise` checks `c.o === f` first, so there is no `lit` term to add and nothing to leak: only your own cities can ever wear it. A city mid-muster wears the `⏳` at its upper-right instead, because `canRaise` is false while `c.mu` stands. `dom-test` matches badges by *where the text landed* (`drewAt`, within 40 units of the disc), since a bare "was `⬆️` drawn anywhere" question is answered by any other city you hold.

**The calendar is derived too, and it is one number.** `T.day` is `1 / P` — ten ticks — and the whole date is `S.tick / T.day`: thirteen 28-day months (Auriel through Lunaris) make a 364-day year. Nothing is stored and nothing needs resetting, because `genMap` already zeroes `S.tick`, so every game opens on **Auriel 1st, year 13312 of the Mazurian Age** — the epoch is the byte budget, which is the only joke in the codebase that costs nothing. The ordinal suffix only ever has to be right for 1 to 28, so `% 20` covers it where `% 10` would print *11st*. The scale is chosen so a p50 war (~4,000 ticks) runs about **400 days** — a year and a bit — a road crossing is roughly a week, a muster six days, and the unrest clock (`T.slow`, 10 ticks) is exactly one day. The end screen scores the campaign in days and, since round 26, in nothing else; that is the first instalment of the "something should push you to finish quicker" topic in `prompts.txt` — a clock the player can read is the precondition for anything that puts them on one. It rides on the **right** of the HUD, beside the speed buttons: `.dt` and `.sp` both carry `margin-left:auto`, and the first one absorbs the slack, so gold stays left and the date lands next to the controls. `dom-test` can only pin the markup there — it has no CSS engine, so the class is asserted and the layout is not; deleting the `.dt` rule fails nothing. `dom-test` drives the date itself off a hand-set `S.tick` at 0, 1, 2, 10, 20, 27, 28, 363 and 364 days, with ticks stopped and the count put back afterwards, so the month roll and the year turn are pinned to literal strings instead of being re-derived by the test.

**There is no Mend order, and removing it made the game better.** Round 23 deleted paid repair outright — `canFix`, `fix`, `c.rp`, `T.repair`, `T.repairStep`, `T.fixRate`, the 🧱 button, `f` from the chime string, and the AI's shore-up-the-weakest-wall branch. What remains is `T.mend`, unchanged at `0.15 * P`: a city puts its own stone back, unbidden and unpaid, and still only while no enemy stands at its gates.

Two things were true of the old order that make this cheaper than it sounds. **Repairs were already blocked during a siege**, so Mend only ever worked *between* attacks — it could not save a city that was actually being taken. And the player never used it, while the AI used it as its nothing-better-to-do action: `fix` sits after every `return` in `step()`, so a faction only repaired on a turn it had no march to make. That made it, in practice, a rule that rewarded idleness.

**Measured** (400 games × three seed ranges at rung 2, `diff-test` at 200 a rung; *before* is round 22's shipped code). Deleting it is an improvement on every axis that matters, because nothing shores up a frontier wall any more and cities fall when they should:

| seed | p50 | p90 | p99 | max | stalemate |
|---|---|---|---|---|---|
| 1000 | 3993→3922 | 7540→**6383** | 13874→**11936** | 17777→17887 | **1→0** |
| 5000 | 4075→3982 | 7576→**6086** | 13733→**9618** | 23902→**11292** | 0→0 |
| 9000 | 4049→3941 | 6690→6568 | 10942→13596 | 15009→16020 | 0→0 |

`diff-test` 0 / 21.0 / 60.5 / 80.5 → 0.5 / 23.0 / 65.0 / 76.0 — monotonic, and flatter at both ends in the way you would expect: the weakest rung is no longer out-fortified and the strongest can no longer out-repair.

**Tripling `T.mend` to cover what the AI's repairs were doing was measured and rejected.** At `0.45 * P` the core stretches ~8% (p50 4333 / 4294 / 4110), p90 goes back up, and seed 1000 grows a 25,349-tick game. Tougher walls are simply longer wars; the passive rate the game already had is the right one.

**The lost gold sink turned out not to be one.** A probe over 30 games either side: the richest realm peaks at a median 1,079 gold with the order in and 1,267 without — 40-odd footmen it was never going to spend, because the binding constraint on an AI army is `T.aiCap`, not the purse. If a sink is ever wanted it needs to be something the AI would actually reach for.

**Onboarding is six tips under the hud, and the step is derived.** `TIP` in `ui.js` is the copy; `tut()` reads which one applies straight off the board — a city selected, a city of yours mustering, a host of yours on the map, a host under command, that host on a road — in the same spirit as the fog and `active()`.

**Nothing in the sequence singles out the capital any more.** Round 27 opened it up: the first tip named no city in particular — the `$` in `TIP[0]` is replaced with `S.F[S.me].em`, which is how the rest of the game says "yours", the hud wearing the same glyph beside the realm name — and step 1 now fires on **any** city being selected, an enemy's included. Step 2 went with it, from the capital's `mu` to any muster of yours, or a player who raised somewhere else would be told to click Raise immediately after clicking Raise. The early-out is now "you hold no city" rather than "you hold no capital", so losing your capital no longer silently ends the tutorial. `dom-test` drives the whole sequence through a city that is deliberately **not** the capital, which is the case the change exists for, and checks an enemy city advances it too.

**Round 31 rewrote the tips to name the act rather than the gesture**, because *Select any $ city* told a new player what to click and never what it was for. They now read *Tap one of YOUR cities ($ color)* · *Tap the "Raise" button to muster a warband* · *Wait for your unit to muster* · *Tap the new unit by the city* · *Tap an enemy city to march on it*. The verb is **tap** throughout, which is the phone's word and reads fine on a mouse. The step ladder did not move and no assertion changed: `tipIs(n)` compares against `TIP[n]`, which is exactly why rewriting the copy is free here and why it also proves nothing — see the note above on what that test can and cannot catch.

**It cost 37 B and had to be paid for.** The copy went in at 13,308 of 13,312 on the first measure, which is not shippable: Roadroller's own run-to-run spread is ±20 B, so four bytes of headroom is no headroom. Trimming the prose was the wrong lever — 27 characters bought only 9 B — and the five extra mangle entries above bought 28 B for nothing. The wording that ships is a little shorter than the request: *(🟠 color)* became *YOUR 🟠 cities*, since the glyph is the colour and the parenthetical was spending bytes to name what it was already showing.

**The tip assertions are keyed by step, never by wording** — `tipIs(n)` compares against `TIP[n]`, which `ui.js` exports for the test and esbuild then tree-shakes back out, so it is free. The copy was rewritten twice in two rounds and every assertion that quoted a phrase went stale the moment it was; quoting copy is the same trap as a negative keyed on a string, one step along. Know the limit of this, though: because the test reads `TIP` itself, **rewording or reordering `TIP` passes** — a test cannot check prose. What it does catch is the step ladder, which is the part that can actually be wrong: four mutations of `d` (the muster step yielding 3, the host step yielding 4, marching not distinguished from resting, the ladder pinned at 0) all fail it. The one thing stored is `S.tut`, and it stores only **how far you got**, never what to show: the tip on screen is always the derived step, while `S.tut` advances monotonically so the sequence knows when its last act (standing the marching host down) has happened. The seventh tip — *Conquer all the cities in the map to win* — is the exception to the derivation: there is no act of the player's that earns or ends it, so standing the host down sets `S.tut` to 6 and only the dismiss link (7) closes it. It also paid for itself: the title screen's two lines of prose, "Raise warbands and conquer the Rainbow Kingdom" and the "space pauses · 1 2 3 set speed" hint, came out, because the tips now say the first and the second was telling the player about keys before they had anything to press them for. Nothing resets it, so a New story does not start the tips again.

**The popup is not over the capital any more — it is in the toast's slot.** Round 27 moved it: `#tip` now takes `top:46px; left:50%; transform:translateX(-50%)` from the stylesheet, the same place a toast appears (and the same `top:78px` under the mobile media query), and `tut()` writes **no inline position at all**. It used to be placed each frame from the capital's world coordinates through `V`, which was fine when the map always fitted the frame and stopped being fine the moment there was a camera: the card moved with the pan, and a player who panned away from their capital lost the instruction telling them what to do. A fixed slot has no such failure mode, and it deleted `ui.js`'s only import from `render.js`.

Two consequences to know. **The card can collide with a toast**, since they now share the slot and the toast has `z-index:5`; in practice they do not overlap, because the tips are done long before the first `⚠️ under attack` fires, and the fix if they ever do is one adjacent-sibling rule (`#toast:not(:empty) + #tip`) — the elements are already in that order in `index.html`. And **the reason recorded for `spot()`'s owner slots is now historical**: counting them from `S.me` (`(a.o - S.me) * 1.2566 + 1.5708`) was done to keep your own hosts under the city and out from under the floating card. The card is gone from there, but the behaviour stays on its own merit — your warbands sit in the same place whichever realm you pick — and `dom-test` still pins it.

`pointer-events:none` on the card with `auto` on the dismiss link stays load-bearing, or it would swallow the very click the first tip asks for. It hides itself when the overlay is up (`ov.innerHTML`) or the game is over, because `ui()` returns early in those cases and would otherwise leave the last tip stranded on screen. `dom-test` plays the whole sequence — select, raise, wait, select the host, march, stand down. It can no longer check *where* the card lands, because that is pure CSS and the stub has no layout engine; what it asserts instead is the other half of the change, that `tip.style.left` and `tip.style.top` are never written, which fails the moment anyone re-adds camera tracking. Mutation-checked both ways.

**It cost the largest-host stat.** The build went 19 B over, and rather than cut the copy the `🔱 largest host` tally went, along with the per-tick loop over every army that fed it. Three pieces of pure fat went with it: `shattered()`'s unused `vis` parameter, `col()`'s dead unowned-city branch in `render.js`, and two `vis` locals that were each down to one use. That is 60 B of headroom, which is thin — the next feature should expect to pay for itself.

**A scenario is two numbers.** `SCN` in `map.js` is `[name, seed, days since the epoch]`, three rows, and that is the whole feature: the seed is the only thing that makes two players' campaigns comparable, and the date is what makes them feel like different ages of one world. There is **no random age** — the board is always one of the three, which is what finally makes `dom-test` and `dist-test` deterministic; a seed in the URL hash still overrides the scenario's on boot, which is the only way to play an unseen map. Picking one on the title screen goes through `hooks.again()`, which already rebuilds the board and redraws the title, so no new hook was needed. `S.d0` shifts **only** what the calendar calls the day: the end-screen score stays `S.tick / T.day`, so a campaign run under Verdant 14001 is still comparable with one run under the epoch.

The three seeds were picked by scanning 400 for a 4/4/4/4/4 opening (77 qualify) and then choosing three different *shapes*: **1098** is diameter 5, 33 edges, no city whose loss splits the map — everyone is everyone's neighbour; **1364** is diameter 8 on 30 edges with **two** cut cities, so the kingdom comes apart at the middle, which is what the name is for; **1337** carries the most roads on the board (35) and the longest. `dom-test` pins the seed and the offset a scenario sets, and two dates worked out by hand from it.

**The title screen is two decks and a button.** SCENARIO over three `.realm` cards (numeral, name, and the date that age opens on), KINGDOM over the five realm cards, the difficulty rungs under those, then `⚔️ Start`. Both decks reuse `.realm` and its `.on` border, which is why `dom-test` keys the highlight assertions on `class="realm on" data-a=s data-i=2` rather than on `/realm on/` — the chosen scenario wears the same class, and the loose version passed with the kingdom highlight deleted. Picking a kingdom is now a *selection*: it sets `S.me`, redraws, and **chimes**, because the reason `s` was kept out of the chime string — the song coming up over it and drowning it — moved to `b`, which is the click that now calls `hooks.start`. The old test encoded that reason rather than the letter, so it survived the move: it asserts the chime happens without the song on `s`, and the song happens without a chime on `b`.

**The warband card says what the disc cannot put in numbers.** Selecting a host used to answer with the split slider and nothing else, which read as a bug — a host in a road melee or mid-march fails `canSplit`, so the panel came back *empty* and the player was left wondering what had broken. It now always reports: `<h3>` glyph and kind name, `⚔️ Size`, `💤 Stamina`, and one row per stat where the kind differs from a footman — `💥 Field`, `🧱 Siege`, `🐾 March`, `🏹 Ambush`. All four are read off `T.K` through one `mult()` helper that **prints nothing at a multiplier of 1**, so a footman host shows two rows and no boasting, and the card needs no per-kind copy: `T.K` grew a name at index 6 and that was the whole of it. Ambush is the only derived one, `1 + (speed - 1) * T.amb` against a footman — which is why a behemoth honestly advertises `×0.73`.

Two details are load-bearing. The card is drawn for **any** host you can select, enemies included: selection already requires `seeArmy`, and the bodies and the fatigue ring are drawn on the disc, so the panel adds no intel the fog had not already allowed — only the multipliers, which are a property of the *kind* and not of that host. And the stamina number is written **imperatively in `sync()`**, into a bare `<b id=st>` left in the diffed string, for exactly the reason the split slider is: fatigue moves every tick, and a value inside the diffed HTML would rewrite the panel — and the slider under the player's thumb — once a tick. `dom-test` pins the card, the empty-panel bug, the baseline rule, the live write, and that a road-locked host loses Split while a host fighting at a city keeps it.

**The end screen is one word and one number.** Round 26 deleted `S.stat` outright — `took`, `lost`, `slain`, the `shattered()` helper and its two call sites, the two counter pairs in `revolt()` and in the siege capture, and the real-time `Xm Ys` — and shortened the titles to **👑 Victory** and **💀 Defeat**. What is left is the realm, the rung, and the campaign in days.

Three things make this cheaper than deleting a feature usually is. The tally was **telling the player what they had just watched** — every capture flashed a shockwave and every broken host vanished off the map in front of them, so the numbers were a receipt for a war they had played. The real-time clock was never the game's own clock: `T.day` is, and `S.elapsed` only ever fed that one line — it **stays**, because `render.js` runs the besieged pulse off it, and it is an animation clock, not a score. And the whole ledger was write-only outside `ending()`, so nothing in the sim read it: `sim-test 1000 2 200` is **byte-identical** before and after, which is the same proof of non-interference the fog changes use, and it is worth spending the twenty seconds to get rather than reasoning about it. It gave back **158 B**.

**Round 31 put the scenario's name on it**, so a result says which of the three boards it was won on: the line is now *Rise of the Golden Horn · 🔴 Crimson Mane · Warlord*. It is **guarded on the seed** — `S.seed === SCN[S.scn][1]` — because a seed in the URL hash overrides the scenario's own on boot, and that is precisely the "play an unseen map" path, where naming it would put a campaign's title on a board it never generated. The guard is 10 B of the feature's 25, and hoisting `SCN[S.scn]` into a local paid for half of it: written out twice it cost 21 B, which is the sort of thing worth one measurement before accepting. `dom-test` reads the expected name off `SCN` rather than quoting it, and pins the guard on a hand-set seed — mutation-checked both ways, the name deleted and the guard dropped, because every other end-screen assertion passes under the second one.

`dom-test` counts the `<b>` tags on the end screen and asserts there is exactly **one**. That shape is deliberate: the assertions it replaced were `!/largest host/` and `!/cities held/`, which are precisely the pattern this file warns about — a negative keyed on a string, which passes for free the moment the string is gone. Counting what is there fails loudly when a number comes back; four mutations were tried against it, including restoring the long titles and the real-time clock.

**Populace and walls are the panel's, not the map's.** `👥pop 🛡walls` used to be drawn under every city, with `🌫️` in their place on a fogged one; that whole line is gone. The numbers are now `👥 Militia` and `🛡️ Walls` (`c.s | 0` against `c.m`, so mending has something to read against) in the city panel. The shield carries a **VS16**, like the `⚔️` a row below it: `U+1F6E1` defaults to *text* presentation, so without it the panel gets a monochrome outline where every other row label is a colour emoji. The bare `🛡` the map used got away with it because canvas resolves emoji through a different font stack. Nothing replaces the fog marker: a fogged city already greys its ring and name and answers `???` in the panel, so the 🌫️ was a third telling of the same thing. `dom-test` pins it: the panel reports the two numbers, and no canvas text under a city name contains `👥`, `🛡` or `🌫️`.

**The disabled Raise button carries its own reason, and round 31 shortened both of them to the state alone.** `⚔️ Pacifying` is `c.oc`, a countdown set to `T.occupy` at capture and decremented every tick; `✊ Restless` is `c.u >= T.calm`, a level that only a garrison brings down. They are independent — a city retaken from *its own* realm is cowed but never restless, since `c.u = max(c.u, T.seize)` is gated on `f !== c.na` — but in practice they chain, because an ungarrisoned conquest crosses `T.calm` at about tick 114 and stays cowed to 180. **Both labels used to carry the number that told you what to do about it** (the wait priced in musters, and `ceil(c.p * T.hold)` warriors) and now neither does: the unrest row above still prints `c.u`, but the garrison a city wants and the length of the occupation are no longer anywhere on the board. That is a deliberate thinning, not an oversight, and it is the first thing to put back if players cannot tell why a city will not conscript. The assertions match on `Pacifying</button>` and `✊ Restless</button>` rather than on the bare word, so they fail loudly if the reason leaves the button instead of passing on some other mention of it in the panel.

## Working here

**Read the source; don't delegate exploring it.** All of `src/` is ~20k tokens, and the game logic without the vendored audio is ~15k. Spawning exploration subagents to map this repo costs an order of magnitude more than reading every line of it — three of them once ran up 206k tokens to summarise files that fit comfortably in context. Grep and read directly.

**The two existing balance harnesses both measure the ladder from the wrong seat, and `probe.mjs` exists because of it.** `diff-test` puts **one** realm on the rung against four Duelists; `sim-test` puts **all five** on the same rung. The player is on `D[1]` against **four** AI realms all on `D[S.diff]`, and nothing measured that until round 31. It matters enormously, because an edge held by four opponents compounds: `diff-test` reads the rungs as 0 / 19.5 / 57 / 77, but from the player's chair the same table reads **19.5 / 3.0 / 2.0** — Warlord and Tyrant nearly indistinguishable, and both a cliff rather than a step down from Duelist. `probe.mjs` runs realm 0 as an AI on Duelist against four on the rung and reports win share *and* the enemy army sizes; it is the harness to reach for when a report is about how the game feels to play rather than whether the sim terminates.

**Round 31 took Warlord's `cap` from 1.45 to 1.25** on a report of unbeatable massed armies. The sweep is the useful part, at 150–200 games a rung across two seed ranges:

| `D[2].cap` | player win share | enemy total warriors, p50 | biggest enemy host, p50 |
|---|---|---|---|
| 1.45 | 3.3% / 6.0% | 1347 / 1376 | 423 / 437 |
| 1.30 | 5.5% / 6.5% | 1275 / 1258 | 423 / 408 |
| **1.25** | **7.3% / 7.3%** | **1264 / 1245** | **418 / 424** |
| 1.20 | 6.5% / 5.5% | 1218 / 1218 | 424 / 422 |
| 1.15 | 8.5% / 7.5% | 1159 / 1171 | 374 / 372 |
| 1.10 | 10.7% / 10.0% | 1156 / 1139 | 397 / 381 |
| 1.00 | 8.0% / 10.0% | 1059 / 1043 | 365 / 385 |

Read two things off it. **The army-size columns move monotonically and the win column does not** — `cap` 1.0 is no better for the player than 1.1, because below roughly 1.1 the ceiling stops being what binds and the rung's edge comes from gold instead. And **win share is noisy between seed ranges** — at 1.15 a third range (13000) read 5.0% both before and after, against 3.0→8.5 and 6.0→7.5 on the other two. Read the table as a shape, not as six decimal places: every step down the `cap` column buys the player a point or two and takes ~5% off the armies he faces, and **the army columns are the ones that move in every range**, which is what the report was actually about. The shipped 1.25 is the conservative end of it — the brief was "a little" — and 1.15 and 1.10 are the next two stops if it is still too steep.

**`acts` was the obvious suspect and is not the lever.** Dropping Warlord to `acts: 1` alongside the new cap measured 5.0 / 6.0 / 8.5% — no better than leaving it at 2. The rung's remaining difficulty is `inc` (1.6x gold, which compounds over a war), so that is the knob if Warlord needs to come down further, with a full re-run.

`diff-test` at 200 a rung went **0 / 19.5 / 57.0 / 77.0 → 0 / 19.5 / 54.5 / 77.0**, still monotonic (48.5% at `cap` 1.15, for reference). The before run reproduced this file's round-30 figures to the game, which is what makes it a control.

**Measure, don't assume.** The balance is tuned against 400-game runs across independent seed ranges, reading p50/p90/p99/max, stalemate count and win distribution. A change is not done until those numbers are back. Two recurring traps: p99 and the tail move long before p50 does, and a single seed range cannot distinguish faction bias from noise.

**Tests here have a habit of passing without testing anything.** Three separate cases turned up in one round: assertions inside an `if` that was never true, with dummy `ok(1)`s in the `else`; and two `!/unknown/` checks that went vacuous when the string they keyed on was deleted. When removing a feature, work out what its tests were *actually* asserting before rewriting them, and prefer assertions that fail loudly if the thing they guard disappears.

**Verify string replacements.** Silent no-op `sed`/`replace` edits have shipped bugs here more than once. Assert the match count, or use a tool that errors on no-match, and `grep` the result.

**AI movement is the highest-risk code in the repo.** Past regressions include 13,000-warrior frozen stacks with 400/400 timeouts, and total gridlock from a movement gate. Round 30 added a third to that list in the opposite direction — armies that were not frozen by a gate but **stranded by a horizon**, scoring only the cities next door and so never finding a front two hops away; see "Crumbling is gone, and the AI can see the whole board". Change `ai.js` only with a full balance re-run. The AI never splits hosts — measured, and not a bug to fix without evidence. It *does* garrison, as of round 21, and the evidence that justified writing that was concrete: doubling `T.stir` gave it a way to lose cities it had no way to answer.

**Visual work has no browser.** There is no headless browser available, so `shot.mjs` is how you actually look at a change: it drives the real game against a recording 2D context and re-emits a frame as SVG, which `qlmanage -t` rasterises into something readable. Rendering blind has repeatedly shipped mistakes that were obvious the moment the frame was looked at — a rainbow entirely hidden behind the island, back when there was one, mountains swallowed by their own tree line, labels invisible on bright grass.

`prompts.txt` is the running log of feature requests; `plan*.md` are per-round plans. Both keep the game's former name, *Unicorn Overlord*, on purpose — they record what was asked at the time, not living documentation. `README.md` is player-facing but currently lags the code: it still describes the event log, the Turn back button and the battle roster, all removed.
