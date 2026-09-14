import { S, D, applyDiff } from './state.js'
import { genMap, SCN } from './map.js'
import { tick, order, seeArmy, active, fighting } from './sim.js'
import { ai } from './ai.js'
import { resize, draw, toWorld, cityR, cv, pan, zoom, gaze } from './render.js'
import { paint } from './terrain.js'
import { ui, title, ending, clearOv, hooks, days } from './ui.js'
import { grind, music, mute, chime, fanfare, clash } from './audio.js'

const TICK = 0.5          // seconds of real time per tick at 1×
let acc = 0, last = 0, playing = 0

let boot = 1
function fresh () {
  const h = boot ? parseInt(location.hash.slice(1)) : 0   // honour a shared seed once, then reroll
  boot = 0
  const c = SCN[S.scn]                       // a scenario is a fixed seed and a start date
  genMap(h > 0 ? h : c[1])                   // a seed in the URL still overrides it, once
  S.d0 = c[2]
  paint()
  location.hash = S.seed
}
hooks.start = f => {
  S.me = f
  S.F.forEach((x, i) => { x.ai = i !== f })
  applyDiff()
  // on a phone the board is wider than the frame, so the war has to open where
  // the player's own is: the middle of their holdings, not the middle of the map
  const mine = S.C.filter(c => c.o === f)
  if (mine.length) gaze(mine.reduce((t, c) => t + c.x, 0) / mine.length,
    mine.reduce((t, c) => t + c.y, 0) / mine.length)
  clearOv(); playing = 1; music(1); ui()
}
hooks.again = () => { fresh(); title(); playing = 0 }

function frame (ts) {
  requestAnimationFrame(frame)
  grind()                   // renders the song a slice at a time, then stops costing anything
  const dt = last ? Math.min(0.1, (ts - last) / 1000) : 0
  last = ts
  if (playing && !S.over) {
    S.elapsed += dt
    acc += dt * S.speed
    let guard = 0
    while (acc >= TICK && guard++ < 8) { acc -= TICK; tick(); ai() }
    S.alpha = Math.min(1, acc / TICK)
    if (S.toastT > 0 && (S.toastT -= dt) <= 0) S.toast = ''
    if (S.over) { ending(); if (S.over > 0) { fanfare(); rank() } }   // the din stops itself below
  }
  draw(dt)
  // the din is derived, like the fog — see fighting() in sim.js. a paused board
  // is a still picture, so the loop stops with it: S.speed is the whole pause
  clash(playing && !S.over && S.speed > 0 && fighting())
  const cur = active() ? 'crosshair' : ''   // the cursor says the map is armed
  if (cv.style.cursor !== cur) cv.style.cursor = cur
  ui()
}

// Pointers: one that stays put is a click on the map, one that travels drags
// the board under it, two of them pinch. The order matters — the tap only fires
// on the way up, once it is known the finger never went anywhere.
const pt = new Map()
let drag = 0, gap = 0

cv.addEventListener('pointerdown', e => {
  pt.set(e.pointerId, { sx: e.clientX, sy: e.clientY, x: e.clientX, y: e.clientY })
  if (pt.size > 1) gap = 0            // a second finger opens a fresh pinch
})

addEventListener('pointermove', e => {
  const p = pt.get(e.pointerId)
  if (!p) return
  const ox = p.x, oy = p.y
  p.x = e.clientX; p.y = e.clientY
  if (pt.size > 1) {
    drag = 1
    const [a, b] = [...pt.values()], d = Math.hypot(a.x - b.x, a.y - b.y)
    if (gap) zoom(d / gap, (a.x + b.x) / 2, (a.y + b.y) / 2)
    gap = d
    return
  }
  // a few pixels of slop first, or a mouse click with any tremor in it would
  // stop being a click. Past that the board slides and the tap is forfeit
  if (!drag && Math.hypot(p.x - p.sx, p.y - p.sy) < 7) return
  drag = 1
  pan(p.x - ox, p.y - oy)
})

addEventListener('pointerup', e => {
  const p = pt.get(e.pointerId)
  pt.delete(e.pointerId)
  if (pt.size) { gap = 0; return }    // a pinch is not over until every finger is up
  const moved = drag; drag = 0
  if (p && !moved) act(p.x, p.y)
})
addEventListener('pointercancel', e => { pt.delete(e.pointerId); if (!pt.size) drag = 0 })

function act (cx, cy) {
  if (!playing || S.over) return
  const p = toWorld(cx, cy)
  // hit-test what the player sees, not the logical spot. kinds refuse to merge,
  // so a node can hold three of your hosts closer together than they are wide —
  // clicking again walks to the next one rather than sticking on the first
  const near = S.A.filter(a => seeArmy(a) && Math.hypot(a.rx - p.x, a.ry - p.y) < 15)
  const cur = near.findIndex(a => S.sel && S.sel.k === 'a' && S.sel.i === a.id)
  const ha = near.length ? near[(cur + 1) % near.length] : null
  let hc = -1
  for (let i = 0; i < S.C.length; i++) {
    const c = S.C[i]
    if (Math.hypot(c.x - p.x, c.y - p.y) < cityR(c) + 6) { hc = i; break }
  }
  const act = active()
  if (act) {                            // a warband is up: the map is its order sheet
    // another of your own hosts is a handover of command, not a destination —
    // it used to stand the warband down, which read as the tap doing nothing.
    // Gated on there being no city under the tap, because a city still has to
    // win the hit test (see below) or you could not march onto one you already
    // hold: a resting host is drawn at cityR + 17 and the city answers to
    // cityR + 6, so the disc beside the city and the city are separate targets
    if (hc < 0 && ha && ha.o === S.me && ha.id !== act.id) {
      S.sel = { k: 'a', i: ha.id }; chime(); return ui()
    }
    // a city, a host resting on one, or an enemy column: head for where that
    // column is going, unless you are standing there already, in which case
    // head for where it came from. Either way you meet it on the road between
    const to = hc >= 0 ? hc
      : ha ? (ha.t < 0 ? ha.a : ha.t === act.a ? ha.a : ha.t) : -1
    if (to >= 0) { order(act, to); chime() }
    else S.sel = null                   // anywhere else stands it down
    return ui()
  }
  S.sel = ha ? { k: 'a', i: ha.id } : hc >= 0 ? { k: 'c', i: hc } : null
  if (S.sel) chime()
  ui()
}

addEventListener('keydown', e => {
  const k = e.key
  if (k === ' ') { e.preventDefault(); S.speed = S.speed ? 0 : 1 }
  else if (k > '0' && k < '5') S.speed = [1, 2, 4, 8][k - 1]
  else if (k === 'm') mute()
  else if (k === 'Escape') S.sel = null
  ui()
})

addEventListener('resize', resize)
resize()
fresh()
title()
requestAnimationFrame(frame)

// Wavedash keeps the game behind its loading screen until this is called, and
// injects the SDK itself on its own host — so the call is guarded exactly the
// way audio.js guards `Audio`, or the game stops booting in every harness, on
// the dev server and off a plain file. The board is loaded the moment the title
// is up: the terrain is baked in fresh(), and the song grinds a slice a frame
// after this, so there is nothing left to wait on.
// `init` MUST NOT go back in the build's mangle allowlist — see build.mjs.
if (typeof Wavedash !== 'undefined') Wavedash.init()

// One leaderboard per scenario per rung — twelve in all — and a score only ever
// goes to the board for the map it was actually played on. A seed from the URL
// hash makes a map nobody else can be ranked against, which is the same guard
// the end screen uses to decide whether to name the scenario at all.
// Only a victory scores: the number is the days a conquest took, so a defeat has
// nothing to report. It is the end screen's own days(), not a second sum.
// The name is built from strings the bundle already carries, so twelve boards
// cost very little more than one would.
function rank () {
  if (typeof Wavedash === 'undefined' || S.seed !== SCN[S.scn][1]) return
  // best-effort, and deliberately so: the war is over and the end screen is
  // already drawn, so nothing here may throw into the render loop. This is not
  // the silent `catch {}` the build once hid a missing compressor in — there is
  // no fact being swallowed, only a network that may not answer.
  Wavedash.getOrCreateLeaderboard(`${SCN[S.scn][0]} · ${D[S.diff].nm}`,
    Wavedash.LeaderboardSortOrder.ASC, Wavedash.LeaderboardDisplayType.NUMERIC)
    .then(r => r.success && Wavedash.uploadLeaderboardScore(r.data.id, days(), true))
    .catch(() => {})
}
