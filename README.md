# 🦄 Horns of Dominion

The Rainbow Kingdom has kept no single crown since the Accord broke. Twenty cities, five
realms — **Crimson Mane**, **Sunmane Reach**, **Verdant Glade**, **Azure Spire**,
**Violet Veil** — and every one of them keeps a horn with a single note in it:
*all of it, or nothing*.

You are one of the five. Total conquest, or the banner falls.

A real-time-with-pause strategy game built for the [js13kgames](https://js13kgames.com)
budget: **13,312 bytes zipped**, no assets, every pixel generated.

## Three ages to fight in

Pick one on the title screen. A scenario is a fixed map and a date, nothing more — the
seed is what makes two campaigns comparable, the date is what makes them feel like
different ages of one world.

| | opens | the kingdom |
|---|---|---|
| **I. Rise of the Golden Horn** | Hearth 23rd, 13312 | close-packed; every realm is a neighbour |
| **II. The Broken Accord** | Lumin 10th, 13986 | long and thin, and it comes apart at two cities |
| **III. The Radiant Spire** | Verdant 13th, 14001 | more roads than any age before, and longer |

Time runs in the Mazurian Age: thirteen months of twenty-eight days, **Auriel** through
**Lunaris**, and your campaign is scored in the days it took you.

## Playing

- **Click your city** → raise a warband. It costs 💎 gold and 👥 populace, and the muster takes time.
- **Click your warband** → it marches at your word (the cursor turns to a crosshair).
- **Click a city** → go there, however many roads away; the march paths itself leg by leg.
- **Click anywhere else** → stand down.
- `space` pauses · `1`–`4` set the pace (1× 2× 4× 8×) · `m` mutes.

A first game walks you through that in seven tips floating over your capital. Dismiss
them whenever you like; they do not come back.

In the map, ownership is the ring colour. The ring around a city is its walls. The number
under a host is bodies; the amber arc around it is how spent they are. ⬆️ marks a city that
can raise something right now, ⏳ one mid-muster, ✊ one too restless to conscript, and a
glyph at the lower right marks what that city breeds. A host under command draws a dashed
path to where it is going.

## Three kinds of warband

Every city raises 🔱 **footmen**. Ten cities raise something else as well: each realm's
capital and its next biggest city breed that realm's own beast, and it belongs to the
*place* — take an enemy capital and the pens come with it.

| | field | walls | march | 💎 | 👥 |
|---|---|---|---|---|---|
| 🔱 footmen | 1 | 1 | 1 | 25 | 40 |
| 🦄 unicorns | 0.6 | 0.5 | 1.9 | 45 | 35 |
| 🐘 behemoths | 2.2 | 2.5 | 0.55 | 50 | 45 |

Every muster is the same forty bodies whatever it raises, so the number under a host is
always a headcount. Kinds will not pool: a mixed force is several warbands standing
together, fanned around their city.

On a road a host fights at the pace it marches — outrun what you land on and you caught it
strung out — so unicorns break footmen, footmen break behemoths, and unicorns maul behemoths
worst of all. Behind walls speed counts for nothing: behemoths breach in a fraction of the
time and unicorns are no siege engine at all. Catching a behemoth column between cities is
the best thing a unicorn ever does.

One rule underpins it: **numbers are health**. Damage comes off bodies while a kind's
strength only multiplies what it deals, so fifty behemoths lose to a hundred footmen for
the same gold.

## What every captain learns

**Warriors tire.** Marching wearies a host; fighting wearies it four times faster, and it
sheds that only standing still. Winded, it moves at half pace — which usually means it
cannot get away. Breaking off a fight costs a quarter of the host on top.

**A city never fights for itself.** Two hosts on a city trade as they would on the road
outside it, less the speed and plus home ground: a host on a city of its own realm swings
20% harder, knowing the streets and the wells. A city spends its defence on the *siege* —
and only once there is nobody left to fight, at which point it is an attrition tax on the
besiegers while the wall points set the clock.

**A city remembers the banner it was drafted under.** Conquer it and it seethes, riots, and
throws you out — no mob, no siege, it simply goes home — unless you leave men enough to sit
on it — roughly one warrior for every seven souls, and twice that to calm it quickly. Those
are men not marching on the next wall. A realm ground down to a rump rallies nobody, so its
lost cities settle and a conquest can finish.

**The fog hides intent, never ground.** You see a city while you hold it, border it, or
stand a host on it; a road while it touches your land or one of your hosts walks it.
Roads and cities are always drawn — fogged ones go dotted and grey — but hosts in the
dark are not, and neither are the battles fought there. The AI plays with full information.

**Walls mend themselves**, slowly, and only while no enemy is at the gates. There is
nothing to order and nothing to pay.

Four difficulty rungs — Dreamer, Duelist, **Warlord** (default), Tyrant — scale the AI's
economy, decisions per turn, army ceiling and grip on conquered cities. Yours never change.

## Running it

    npm install
    npm run dev      # http://localhost:8080, rebuilds on save
    npm run build    # writes dist/index.html + dist/game.zip, fails over 13312 B
    npm run size     # one line: <zipped> / 13312

`npm run dev` skips minification and packing, so the size it prints is meaningless — only
`build` and `size` report a real number.

## Layout

| file | role |
|---|---|
| `src/state.js` | shared state and the `T` table of every balance constant |
| `src/map.js` | seeded 20-node planar graph, city stats, realm draft, the scenarios |
| `src/sim.js` | one tick: income, movement, battle, siege, capture, unrest, stamina, victory |
| `src/ai.js` | rule-based faction controller, one faction per turn |
| `src/terrain.js` | the ground — grass, woods, peaks — baked once per seed |
| `src/render.js` | canvas: backdrop, roads, cities, warbands, effects |
| `src/ui.js` | HUD, calendar, panels, onboarding, title and end screens |
| `src/audio.js` | generated song and four effects, ground one instrument a frame |
| `build.mjs` | esbuild → Roadroller → hand-rolled zopfli zip → size gate |

## Checks

There is no test runner; each harness is a standalone script that imports the real
modules, prints `ok`/`FAIL` lines and exits non-zero.

    node cmd-test.mjs    # flee cost, pathing, splitting, muster, unrest, kinds, stamina
    node road-test.mjs   # road engagements, deterministic placements, no AI
    node dom-test.mjs    # drives the real modules against a stub browser
    node dist-test.mjs   # boots the shipped, packed dist/index.html
    node sim-test.mjs    # 400 headless games: pacing, fairness, stalemate hunt
    node diff-test.mjs   # is the difficulty ladder monotonic?
    node geo.mjs         # terrain: feature spread, counts, forest cover
    node shot.mjs        # render one frame to SVG, since there is no browser here

`src/state.js` opens with `const P = 0.1` — the global pace. It scales every *rate*
(gold, growth, marching, attrition, siege, mending, unrest, AI cadence) and leaves
quantities alone, so the whole game speeds up or slows down without a single balance
ratio shifting.

## Credits

- Music: **rybar**
- Design and programming: **slashie**

`src/player.js` is [SoundBox](https://sb.bitsnbites.eu/)'s `player-small.js` by Marcus
Geelnard, under the zlib licence, altered only to export `CPlayer` and drop an unused
function. Everything else — the land, the music, the sound effects, every glyph that
is not an emoji — is generated at runtime.
