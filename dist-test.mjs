// verifies the shipped, minified dist/index.html actually boots. Not shipped.
import { readFileSync } from 'fs'
const html = readFileSync('dist/index.html', 'utf8')
const els = {}
// every glyph the canvas is asked to draw, so the packed build can be checked
// for the ones that only exist as string literals inside the payload
const drew = []
const ctx = new Proxy({}, {
  get: (t, k) => k === 'fillText' ? (s => (drew.push(String(s)), ctx))
    : (k in t ? t[k] : (t[k] = () => ctx)),
  set: (t, k, v) => (t[k] = v, true)
})
// created on demand, so adding an element to index.html cannot silently break this
const mk = id => (els[id] = {
  id, dataset: {}, style: {}, innerHTML: '',
  addEventListener (t, f) { (this.h ||= {})[t] = f },
  getContext: () => ctx
})
const win = { h: {} }, doc = { h: {} }
const head = { appendChild: n => n }
// a separate registry from the window's: audio.js listens on the document for
// visibilitychange, and this stub is what made the packed build run it at all
globalThis.document = { getElementById: id => els[id] || mk(id), createElement: () => mk('_c'), head, activeElement: null,
  hidden: false, addEventListener: (t, f) => { doc.h[t] = f } }
globalThis.location = { _h: '', get hash () { return this._h }, set hash (v) { this._h = '#' + v } }
globalThis.devicePixelRatio = 1
globalThis.innerWidth = 1200; globalThis.innerHeight = 800
globalThis.addEventListener = (t, f) => { win.h[t] = f }
let rafq = []
globalThis.requestAnimationFrame = f => rafq.push(f)
// Audio was never stubbed here, so audio.js's `typeof Audio` guard switched the
// whole of it off and the packed build's song and effects were the one part of
// the bundle no harness ever ran. Node has Blob and URL.createObjectURL, so the
// element is all it takes — and now grind() renders every track for real
const made = []
globalThis.Audio = class {
  constructor (src) { this.src = src; this.paused = true; made.push(this) }
  play () { this.paused = false; return Promise.resolve() }
  pause () { this.paused = true }
}

// Wavedash injects this ahead of the bundle on its own host, so nothing else
// ever defines it. Stubbing it here is the only way the call is exercised at
// all — and, because this is the one harness that runs the MANGLED bundle, the
// only way `init` slipping back into build.mjs's allowlist can be caught. It
// was in there for one round and turned the call into `Wavedash.Mt()`.
const wd = []
globalThis.Wavedash = {
  init: (...a) => wd.push(['init', ...a]),
  updateLoadProgressZeroToOne: p => wd.push(['progress', p]),
  LeaderboardSortOrder: { ASC: 0, DESC: 1 },
  LeaderboardDisplayType: { NUMERIC: 0, TIME_SECONDS: 1, TIME_MILLISECONDS: 2, TIME_GAME_TICKS: 3 },
  getOrCreateLeaderboard: (name, sort, disp) =>
    (wd.push(['board', name, sort, disp]), Promise.resolve({ success: true, data: { id: 'lb1' } })),
  uploadLeaderboardScore: (id, score, keep) =>
    (wd.push(['score', id, score, keep]), Promise.resolve({ success: true, data: { globalRank: 1 } }))
}

let fail = 0
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail = 1 }

ok(/<style>body\{background:#0b0a12\}<\/style>/.test(html), 'critical css left in the shell')
ok(/appendChild\(document\.createElement|<style>\*\{/.test(html) || html.length < 25000, 'the rest rides in the payload')
ok(!/\n\s\s/.test(html), 'html collapsed')
ok(!html.includes('/*JS*/') && !html.includes('/*CSS*/'), 'no placeholders left behind')

const js = html.split('<script>')[1].split('</script>')[0]
new Function(js)()

ok(/Horns of Dominion/.test(els.ov.innerHTML), 'minified bundle boots to the title screen')
// the game stays hidden behind Wavedash's loading screen until init() is
// called, so this failing means the shipped build never appears on the host
ok(wd.some(c => c[0] === 'init'), 'and tells Wavedash it has loaded, through the mangled bundle')
const tap = (a, i) => {
  const el = { dataset: { a, i }, closest: () => el }
  win.h.click({ target: el })
}
tap('s', '1')                                   // the kingdom is a selection...
ok(els.ov.innerHTML !== '', 'realm pick alone does not start the game')
tap('b')                                        // ...and Start commits it
ok(els.ov.innerHTML === '', 'Start clears the title and starts the game')
let t = 0
for (let i = 0; i < 200; i++) { const q = rafq; rafq = []; t += 100; q.forEach(f => f(t)) }
ok(/💎/.test(els.hud.innerHTML), 'hud alive in the minified build')
// the packed build is the only place the listener's TARGET is proved: it is
// registered on the document, and a bundle that put it on the window would not
// appear in doc.h at all. Backgrounding has to reach the mangled play()
ok(typeof doc.h.visibilitychange === 'function', 'the packed build listens on the document for backgrounding')
ok(made[0] && !made[0].paused, 'the song is playing before the tab goes away')
document.hidden = true; doc.h.visibilitychange()
ok(made[0].paused, 'and backgrounding stops it in the mangled bundle')
document.hidden = false; doc.h.visibilitychange()
ok(!made[0].paused, 'coming back starts it again')
ok(/🔴|🟠|🟢|🔵|🟣/.test(els.hud.innerHTML), 'standings render')
// the board is scenario I now, so this is the same map every run — but the
// assertion holds for any of them: a realm always breeds at two of its cities
ok(drew.some(t => t === '🦄' || t === '🐘'),
  'a specialist glyph survives the pack and reaches the canvas')
const early = els.hud.innerHTML

// Play the packed build to a finish. This is the only harness that runs the
// *shipped* bundle, and since round 28 that bundle has its property names
// mangled — so a smoke test of forty ticks is not enough cover for it. A whole
// war touches nearly every property there is: sieges, unrest, revolts, stamina,
// crumbling realms, the calendar rolling over, and the victory check.
tap('v', '8')
for (let i = 0; i < 40000 && !els.ov.innerHTML; i++) {
  const q = rafq; rafq = []; t += 100; q.forEach(f => f(t))
}
ok(made.length === 5, `and grinds all five tracks on the way (${made.length})`)
ok(/Victory|Defeat/.test(els.ov.innerHTML), 'the packed build plays a whole war to an ending')
ok(/<b>\d+<\/b>/.test(els.ov.innerHTML), 'and scores it in days')
ok(els.hud.innerHTML !== early && /year \d+/.test(early),
  'while the calendar ran under it')
// this run ends in a Defeat — the player realm is never driven, so no realm
// choice here reaches a Victory. That makes a positive leaderboard assertion
// vacuous, which is why the submission's logic is pinned in dom-test and its
// SDK names are pinned by build.mjs before roadroller hides them. What IS
// testable here is the other half of the rule: a lost war scores nothing.
ok(!wd.some(c => c[0] === 'score' || c[0] === 'board'),
  'and a defeat is not put on a leaderboard')

console.log(fail ? '\nFAILURES' : '\nall good')
process.exit(fail)
