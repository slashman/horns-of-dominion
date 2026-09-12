// DOM smoke test — drives the real modules against a stub browser. Not shipped.
const els = {}
const mk = id => {
  const e = {
    id, _html: '', dataset: {}, style: {},
    get innerHTML () { return this._html },
    set innerHTML (v) { this._html = v },
    addEventListener (t, f) { (this.h ||= {})[t] = f },
    getContext: () => ctx
  }
  return (els[id] = e)
}
const drew = [], drewAt = []                      // canvas text, so the map can be read
let path = []                                     // and its strokes, so lines can be too
const strokes = []
const ctx = new Proxy({
  fillText: (t, px, py) => (drew.push(String(t)), drewAt.push([String(t), px, py]), ctx),
  beginPath: () => (path = [], ctx),
  moveTo: (px, py) => (path.push([px, py]), ctx),
  lineTo: (px, py) => (path.push([px, py]), ctx),
  stroke: () => (strokes.push([ctx.strokeStyle, path.slice()]), ctx)
}, {
  get: (t, k) => (k in t ? t[k] : (t[k] = () => ctx)),   // gradients chain
  set: (t, k, v) => (t[k] = v, true)
})
;['cv', 'hud', 'pan', 'ov'].forEach(mk)

const win = { h: {} }
// document and window keep SEPARATE handler registries on purpose: a listener
// put on the wrong one of them is a real bug that a shared bag cannot see —
// visibilitychange is dispatched at the document, and was once on the window here
const doc = { h: {} }
globalThis.document = { getElementById: id => els[id] || mk(id), createElement: () => mk('_c'), activeElement: null,
  addEventListener: (t, f) => { doc.h[t] = f } }
globalThis.location = { _h: '', get hash () { return this._h }, set hash (v) { this._h = '#' + v } }
globalThis.devicePixelRatio = 2
globalThis.innerWidth = 1280
globalThis.innerHeight = 800
globalThis.addEventListener = (t, f) => { win.h[t] = f }
let rafq = []
globalThis.requestAnimationFrame = f => rafq.push(f)

// audio: Node has Blob and URL.createObjectURL already, so only the element is
// stubbed. The tracks are ground for real, which is the point — a broken effect
// throws here rather than in the browser. made[] is creation order, which
// audio.js fixes: 0 song · 1 horn · 2 chime · 3 fanfare · 4 clash
const SONG = 0, HORN = 1, CHIME = 2, FANFARE = 3, CLASH = 4
const made = [], played = []
globalThis.Audio = class {
  constructor (src) {
    this.i = made.length; this.src = src
    this.loop = false; this.volume = 1; this.paused = true; this.currentTime = 0
    made.push(this)
  }
  play () { this.paused = false; played.push(this.i); return Promise.resolve() }
  pause () { this.paused = true }
}

const { S, T, W, H } = await import('./src/state.js')
const { active, seeArmy } = await import('./src/sim.js')
const { cityR, V } = await import('./src/render.js')
const { SCN } = await import('./src/map.js')
const { TIP, ending } = await import('./src/ui.js')
const { mute } = await import('./src/audio.js')
await import('./src/main.js')

const step = (n, ms = 16.7) => {
  let t = step.t || 0
  for (let i = 0; i < n; i++) {
    const q = rafq; rafq = []
    t += ms
    q.forEach(f => f(t))
  }
  step.t = t
}
const typeIn = (id, v) => {
  const el = els[id]; el.value = String(v)
  win.h.input({ target: el })
}
const click = (a, i) => {
  const el = { dataset: { a, i: String(i) }, closest: () => el }
  win.h.click({ target: el })
}
// world coords -> screen, off the live view rather than a second copy of the
// projection: this used to restate the scale and offsets and went stale the
// day they changed
// a tap is a press and a release at the same spot — the map only acts on the
// way up, since a pointer that travels in between is a pan and not a click
const spot = (wx, wy) => ({ pointerId: 1, clientX: wx * V.s + V.ox, clientY: wy * V.s + V.oy })
const tap = (wx, wy) => { const e = spot(wx, wy); els.cv.h.pointerdown(e); win.h.pointerup(e) }
// and a press, a drag and a release is a pan: it moves the camera, lands no click
const swipe = (wx, wy, dx, dy) => {
  const e = spot(wx, wy), q = { pointerId: 1, clientX: e.clientX + dx, clientY: e.clientY + dy }
  els.cv.h.pointerdown(e); win.h.pointermove(q); win.h.pointerup(q)
}

let fail = 0
const ok = (c, m) => { console.log((c ? '  ok   ' : '  FAIL ') + m); if (!c) fail = 1 }

ok(/Horns of Dominion/.test(els.ov.innerHTML), 'title screen renders')
ok(els.ov.innerHTML.split('data-a=s ').length === 6, 'five realm cards offered')

ok(/data-a=d/.test(els.ov.innerHTML), 'title offers difficulty rungs')
click('d', 3)
ok(S.diff === 3, 'picking a rung sets it')
click('d', 2)
ok(S.diff === 2, 'and the default rung is the third')

// a scenario is a seed and a date and nothing else, so it can be checked as two
// numbers. There is no random age any more: the board is always one of the three,
// which is what finally makes this whole file deterministic
ok(els.ov.innerHTML.split('data-a=c').length === 4, 'title offers three scenarios')
ok(els.ov.innerHTML.includes('<div class=e>III</div>'), 'each carrying its numeral')
ok(els.ov.innerHTML.includes('Hearth 23rd, year 13312'), 'and the date it opens on')
click('c', 1)
ok(S.scn === 1 && S.seed === SCN[1][1], `picking one fixes the seed (${SCN[1][1]})`)
ok(S.d0 === SCN[1][2], 'and the day its calendar opens on')
click('c', 0)
ok(S.scn === 0 && S.seed === SCN[0][1] && S.d0 === SCN[0][2], 'and another swaps both again')
ok(/class="realm on" data-a=c data-i=0/.test(els.ov.innerHTML), 'the chosen scenario is marked')

// the kingdom is a selection now; Start is what commits
click('s', 2)
ok(S.me === 2 && els.ov.innerHTML !== '', 'picking a realm selects it and does not start the game')
// keyed to the card that picks a kingdom: both decks are .realm, and the chosen
// scenario wears the same 'on', so a bare /realm on/ would pass without this
ok(/class="realm on" data-a=s data-i=2/.test(els.ov.innerHTML), 'and the chosen kingdom is marked')
click('b')
ok(S.me === 2 && !S.F[2].ai && !!S.F[0].ai, 'Start commits it and sets the player faction')
ok(els.ov.innerHTML === '', 'overlay cleared on start')
step(3)
ok(/💎/.test(els.hud.innerHTML), 'hud renders after start')
ok(els.hud.innerHTML.includes(S.F[2].nm) && els.hud.innerHTML.includes(S.F[2].em),
  'hud names your realm')

// the calendar is S.tick over T.day and nothing else, so it can be read off a
// tick count set by hand. Ticks are stopped and the count put back afterwards,
// or every escal- and bold-scaled number below would move with it
// the age hangs in a span of its own, which a narrow hud hides. The assertion
// carries it verbatim, so deleting the span fails here rather than going vacuous
const AGE = '<span class=ag> of the Mazurian Age</span>'
const tickWas = S.tick, speedWas = S.speed, d0Was = S.d0
S.speed = 0; S.d0 = 0
const on = (t, d) => {
  S.tick = t * T.day; step(1)
  ok(els.hud.innerHTML.includes('<b>' + d + AGE + '</b>'), d)
}
on(0, 'Auriel 1st, year 13312')
on(1, 'Auriel 2nd, year 13312')
on(2, 'Auriel 3rd, year 13312')
on(10, 'Auriel 11th, year 13312')          // not 11st, which is what % 10 would give
on(20, 'Auriel 21st, year 13312')
on(27, 'Auriel 28th, year 13312')
on(28, 'Florin 1st, year 13312')
on(363, 'Lunaris 28th, year 13312')
on(364, 'Auriel 1st, year 13313')
// and it rides on the right, by the speed buttons: .dt takes the slack, so the
// gold stays left and the date lands next to the controls
const hudH = els.hud.innerHTML
ok(/class=dt><b>/.test(hudH), 'the date carries the class that pushes it right')
ok(hudH.indexOf('💎') < hudH.indexOf('Mazurian') && hudH.indexOf('Mazurian') < hudH.indexOf('data-a=q'),
  'and sits after the gold and before the buttons')
// a scenario shifts only what the calendar calls the day. Both dates below are
// worked out by hand from its offset, not re-derived from the code
S.d0 = SCN[1][2]; S.tick = 0; step(1)
ok(els.hud.innerHTML.includes('<b>Lumin 10th, year 13986' + AGE + '</b>'),
  'a scenario opens the calendar on its own date')
S.tick = 27 * T.day; step(1)
ok(els.hud.innerHTML.includes('<b>Hearth 9th, year 13986'), 'and the months run on from there')
S.tick = tickWas; S.speed = speedWas; S.d0 = d0Was; step(1)

const g0 = S.F[2].g
step(120)                              // ~2s -> 4 ticks
ok(S.tick > 0, 'ticks advance: ' + S.tick)
ok(S.F[2].g > g0, 'gold accrues (' + (g0 | 0) + ' -> ' + (S.F[2].g | 0) + ')')

S.speed = 0
const t0 = S.tick
step(120)
ok(S.tick === t0, 'pause freezes the simulation')
S.speed = 1

// select one of my cities and raise an army
const mine = S.C.findIndex(c => c.o === 2)
played.length = 0
tap(S.C[mine].x, S.C[mine].y)
ok(S.sel && S.sel.k === 'c' && S.sel.i === mine, 'clicking a city selects it')

// --- audio ------------------------------------------------------------------
ok(made.length === 5, 'the song and all four effects render (' + made.length + ' of 5)')
ok(made.every(a => a.src.startsWith('blob:')), 'each as its own wav blob')
ok(made[SONG].loop && made[CLASH].loop, 'the song and the din of battle loop')
ok(!made[HORN].loop && !made[CHIME].loop && !made[FANFARE].loop, 'the one-shots do not')
ok(made[CLASH].volume < made[SONG].volume, 'the din sits under the song')
ok(!made[SONG].paused, 'the song plays once a realm is picked')
ok(played.includes(CHIME), 'inspecting a town chimes')
win.h.keydown({ key: 'm' })
played.length = 0
tap(S.C[mine].x, S.C[mine].y)
ok(!played.length, 'and muting silences it')
ok(made[SONG].paused, 'along with the song')
win.h.keydown({ key: 'm' })
ok(!made[SONG].paused, 'unmuting brings the song back')
step(1)
ok(/Raise/.test(els.pan.innerHTML), 'city panel offers Raise')
S.F[2].g = 999; S.C[mine].p = 200
const n0 = S.A.length
click('r', mine)
ok(S.A.length === n0 && S.C[mine].mu > 0, 'raise starts a muster, not an instant warband')
step(2)
ok(/Mustering/.test(els.pan.innerHTML), 'the panel shows muster progress')
S.speed = 8
for (let k = 0; k < 400 && S.A.length === n0; k++) step(1)
S.speed = 1
ok(S.A.length === n0 + 1, 'the warband appears once mustered')
const army = S.A[S.A.length - 1]
ok(army.o === 2 && army.a === mine, 'warband belongs to me, at my city')

// --- the specialist button ---------------------------------------------------
// a plain city offers riders only; a city that breeds something offers both
const plain = S.C.findIndex(c => c.o === 2 && !c.sp)
S.sel = { k: 'c', i: plain }; step(1)
ok(!/data-a=g/.test(els.pan.innerHTML), 'a plain city offers no specialist')
const bred = S.C.findIndex(c => c.o === 2 && c.sp)
const kind = S.C[bred].sp
S.C[bred].p = 200; S.C[bred].oc = 0; S.C[bred].u = 0; S.C[bred].mu = 0
S.sel = { k: 'c', i: bred }; step(1)
ok(/data-a=g/.test(els.pan.innerHTML), 'a breeding city offers a second Raise')
ok(els.pan.innerHTML.includes(T.K[kind][5]), `labelled with its own glyph (${T.K[kind][5]})`)
ok(els.pan.innerHTML.includes('💎' + T.K[kind][3]), `and its own price (💎${T.K[kind][3]})`)
const seen = S.A.map(a => a.id)
click('g', bred)
ok(S.C[bred].mu > 0 && S.C[bred].mk === kind, 'clicking it musters that kind')
// other realms are mustering too, so look for *my* new host at *that* city
const born = () => S.A.find(a => !seen.includes(a.id) && a.o === S.me && a.a === bred)
S.speed = 8
for (let k = 0; k < 400 && !born(); k++) step(1)
S.speed = 1
const got = born()
ok(!!got, 'and the warband arrives')
ok(got && got.k === kind, 'as the kind the city breeds')
S.A = S.A.filter(a => seen.includes(a.id)); S.sel = null

// picking a host up is what puts it under command — the map is its order sheet
step(1)
played.length = 0
tap(army.rx, army.ry)
ok(S.sel && S.sel.k === 'a' && S.sel.i === army.id, 'clicking a warband selects it')
ok(played.includes(CHIME), 'and picking it up chimes')
ok(active() === army, 'and that alone puts it under command')
// the warband card is back, and it carries the two things the map cannot say in
// numbers: how many bodies are left and how spent they are. The march is still
// the map's to tell — a dashed path to a lit destination — so it stays out
ok(els.pan.innerHTML.includes(T.K[army.k][6]), 'a selected warband names its kind')
ok(els.pan.innerHTML.includes('⚔️ Size</span><span>' + (army.w | 0)), 'and counts its warriors')
ok(/💤 Stamina/.test(els.pan.innerHTML), 'and carries a stamina row')
ok(els.st.textContent === 100 - (army.fg | 0) + '%',
  `whose number is written live, out of the diffed string (${els.st.textContent})`)
ok(!/Banner|Status|Bound for/.test(els.pan.innerHTML),
  'but no banner and no march readout — the map says both')
ok(army.k === 0 && !/×/.test(els.pan.innerHTML),
  'and a footman host prints no multiplier at all: it is the baseline')

// the multipliers are read off T.K rather than spelled out per kind, so a kind
// that is better at something says so and one that is worse says that too
army.k = 2; step(1)
ok(els.pan.innerHTML.includes('🧱 Siege</span><span>×' + T.K[2][1]), 'a behemoth advertises its siege weight')
ok(els.pan.innerHTML.includes('🐾 March</span><span>×' + T.K[2][2]), 'and the march that pays for it')
ok(/🏹 Ambush<\/span><span>×0\.73/.test(els.pan.innerHTML),
  'and the ambush penalty a slow host takes on a road')
army.k = 0; step(1)

const dest = S.C[mine].n[0]
played.length = 0
tap(S.C[dest].x, S.C[dest].y)
ok(army.t === dest, 'clicking a city marches it there')
ok(played.includes(CHIME), 'and naming a destination chimes')
ok(active() === army, 'and it stays under command, so the order can be redirected')

// a city always wins the hit test over a host standing on it, or a march could
// never be turned around: at pr 0 the host sits exactly on the city it left
tap(S.C[mine].x, S.C[mine].y)
ok(army.t === mine && army.a === dest, 'clicking the city it left turns the march around')

// --- tapping another host of yours hands command over ----------------------
// it used to stand the warband down, which reads as the tap doing nothing. A
// city still wins the hit test, so this is gated on there being none under the
// tap — a resting host is drawn at cityR + 17 and the city answers to cityR + 6
const mate = { id: 9101, o: S.me, w: 30, k: 0, a: mine, t: S.C[mine].n[0], pr: 0.5, st: 0, dst: -1, hold: 0, fg: 0 }
S.A.push(mate); step(1)
S.sel = { k: 'a', i: army.id }
played.length = 0
tap(mate.rx, mate.ry)
ok(S.sel.k === 'a' && S.sel.i === mate.id && active() === mate,
  'tapping another of your hosts puts that one under command')
ok(played.includes(CHIME), 'and the handover chimes')

// the invariant the gate protects, and it has to be tested on a host drawn *on*
// the city: a resting one sits at cityR + 17 and can never shadow it, but one
// marching out at progress 0 is drawn dead on the centre. Without the gate that
// host answers the tap and you could never march a second one in to reinforce
const leaving = { id: 9103, o: S.me, w: 30, k: 0, a: dest, t: S.C[dest].n[0], pr: 0, st: 0, dst: -1, hold: 0, fg: 0 }
S.A.push(leaving); step(1)
ok(Math.hypot(leaving.rx - S.C[dest].x, leaving.ry - S.C[dest].y) < 15,
  'a host marching out at progress 0 is drawn on the city it left')
S.sel = { k: 'a', i: mate.id }
mate.a = mine; mate.t = -1; mate.pr = 0; mate.dst = -1
tap(S.C[dest].x, S.C[dest].y)
ok(mate.t === dest && S.sel.i === mate.id,
  'and the city still wins that tap: a destination, not a handover')

// --- an enemy column is a destination too ----------------------------------
// a road cannot be tapped, so the column itself is the only way to say "go and
// meet that". Head for where it is going — unless you are standing there, in
// which case head for where it came from. Either way you meet it between
const foe = { id: 9102, o: (S.me + 1) % S.F.length, w: 30, k: 0, a: dest, t: mine, pr: 0.5, st: 0, dst: -1, hold: 0, fg: 0 }
S.A.push(foe); step(1)
ok(seeArmy(foe), 'the column is in sight, so it can be tapped at all')

army.a = mine; army.t = -1; army.pr = 0; army.dst = -1; army.st = 0
S.sel = { k: 'a', i: army.id }
tap(foe.rx, foe.ry)
ok(army.t === dest, 'standing where a column is headed, you march out to meet it head-on')

army.a = dest; army.t = -1; army.pr = 0; army.dst = -1; army.st = 0
S.sel = { k: 'a', i: army.id }
tap(foe.rx, foe.ry)
ok(army.t === mine, 'standing where it set out, you follow it to where it is going')

S.A = S.A.filter(a => a.id !== 9101 && a.id !== 9102 && a.id !== 9103)
army.a = dest; army.t = mine; army.pr = 0; army.dst = -1; army.st = 0
S.sel = { k: 'a', i: army.id }

tap(6, 6)                                  // empty sky
ok(!active() && !S.sel, 'clicking anywhere else stands the warband down')

tap(S.C[dest].x, S.C[dest].y)
ok(S.sel.k === 'c' && S.sel.i === dest, 'with nothing under command a city click only selects')

tap(army.rx, army.ry)
win.h.keydown({ key: 'Escape' })
ok(!S.sel && !active(), 'escape stands it down')

// interpolation: the drawn position must advance between ticks, not only on them
step(1)
const rxWas = army.rx, prWas = army.pr
step(2)
ok(army.pr === prWas && army.rx !== rxWas,
  'the render position advances between ticks, with no tick in between')
step(40)
ok(army.t < 0 || army.pr > 0, 'the warband is moving / arrived')

// a moving warband must be clickable where it is drawn, not where it logically is
if (army.t >= 0) {
  S.sel = null
  tap(army.rx, army.ry)
  ok(S.sel && S.sel.k === 'a' && S.sel.i === army.id, 'a marching warband is clickable at its drawn spot')
} else {
  ok(1, 'warband arrived before the drawn-spot check could run')
}

// mending: no order, no gold, no button. A knocked-about city puts its own
// stone back, which is the whole of what the Mend command used to buy
const w0 = S.C[mine].s = 5
S.F[2].g = 0
S.speed = 8
for (let k = 0; k < 200; k++) step(1)
S.speed = 1
ok(S.C[mine].s > w0, 'walls rise unbidden (' + w0 + ' -> ' + (S.C[mine].s | 0) + ')')
ok(S.C[mine].s <= S.C[mine].m, 'and stop at the wall they are rebuilding')
S.sel = { k: 'c', i: mine }; step(1)
ok(!/data-a=f|Mend|Rebuilding/.test(els.pan.innerHTML),
  'and the city panel carries no Mend order any more')
S.sel = null

// --- onboarding: six tips under the hud, and a way out of them -------------
// the step is read off the board, so the sequence can be driven by playing it
const armiesWere = S.A
S.A = []; S.sel = null; S.tut = 0; S.C.forEach(c => { c.mu = 0 })
const cap = S.C.findIndex(c => c.cap && c.o === S.me)
// the sequence is driven through a city that is NOT the capital, which is the
// whole point of the step-1 rule: any city of yours carries the tutorial on
const burg = S.C.findIndex((c, k) => c.o === S.me && k !== cap)
// The tips are keyed by STEP, never by their wording. The copy has been
// rewritten twice now and every assertion that quoted it went stale on the spot
// — which is the same trap as a negative keyed on a string, one step along.
// TIP[n] is the contract; what it happens to say is not.
const tipIs = n => els.tip.innerHTML.startsWith(TIP[n].replace('$', S.F[S.me].em))
step(1)
ok(tipIs(0), `the sequence opens on its first tip ("${TIP[0]}")`)
ok(TIP[0].includes('$') && els.tip.innerHTML.includes(S.F[S.me].em) &&
   !els.tip.innerHTML.includes('$'),
  'which wears your own realm glyph in place of its $ marker')
// the card sits in the toast's slot now, which is pure CSS and beyond a stub
// with no layout engine. What *is* testable is the other half of that change:
// tut() writes no inline position at all any more, so the card cannot follow
// the camera or be panned off the screen. Re-adding either write fails this
ok(els.tip.style.left === undefined && els.tip.style.top === undefined,
  'and is placed by the stylesheet, not from the capital every frame')
ok(/data-a=z/.test(els.tip.innerHTML), 'with a way out of it')
// an enemy city advances it too — the step is "a city is selected", full stop
S.sel = { k: 'c', i: S.C.findIndex(c => c.o !== S.me) }; step(1)
ok(tipIs(1), 'selecting any city at all moves it on')
S.sel = { k: 'c', i: burg }; step(1)
ok(tipIs(1), 'a city of yours that is not the capital does too')
S.F[2].g = 999
click('r', burg); step(1)
ok(tipIs(2), 'and mustering there moves it on again')
S.C[burg].mu = 1                         // one tick from done: the muster itself is
S.speed = 8                              // tested above, and running 100 ticks here
for (let k = 0; k < 12 && !S.A.length; k++) step(1)   // would move the whole war on
S.speed = 1
S.sel = null; step(1)
ok(S.A.length === 1 && tipIs(3), 'the warband arrives and the tip points at it')
S.sel = { k: 'a', i: S.A[0].id }; step(1)
ok(tipIs(4), 'taking command asks for a destination')
tap(S.C[S.C[burg].n[0]].x, S.C[S.C[burg].n[0]].y); step(1)
ok(S.A[0].t >= 0 && tipIs(5), 'and marching asks you to stand it down')
S.sel = null; step(1)
ok(tipIs(6), 'and standing it down earns the last word')
S.sel = { k: 'a', i: S.A[0].id }; step(1)
ok(tipIs(6), 'which stays put, since no move of yours can end it')
click('z'); step(1)
ok(els.tip.innerHTML === '', 'only dismiss ends the onboarding')
S.sel = null; step(1)
ok(els.tip.innerHTML === '', 'and it stays ended')

// the dismiss link is the other way out, from wherever you are
S.tut = 0; S.sel = null; S.A = []; step(1)
ok(tipIs(0), 'the tips can run again from the start')
click('z'); step(1)
ok(els.tip.innerHTML === '', 'and dismiss closes them for good')
S.A = armiesWere; S.sel = null

// speed buttons and keys
played.length = 0
click('v', 4); ok(S.speed === 4, 'speed button sets 4x')
ok(played.includes(CHIME), 'and chimes')
win.h.keydown({ key: ' ', preventDefault () {} }); ok(S.speed === 0, 'space pauses')
win.h.keydown({ key: '2' }); ok(S.speed === 2, 'key 2 sets speed')
win.h.keydown({ key: 'Escape' })
win.h.keydown({ key: 'Escape' })
ok(S.sel === null && !S.aim, 'escape clears targeting, then the selection')

// --- multi-hop marching, splitting, and engagement bookkeeping -------------
S.F[2].g = 999
const home = S.C.findIndex(c => c.o === 2)
S.C[home].p = 300
const far = (() => {                       // a city three hops from home
  const d = new Array(20).fill(-1); d[home] = 0
  const q = [home]
  for (let h = 0; h < q.length; h++) for (const v of S.C[q[h]].n) if (d[v] < 0) { d[v] = d[q[h]] + 1; q.push(v) }
  return d.findIndex(x => x === 3)
})()
S.A = [{ id: 5001, o: 2, w: 120, k: 0, a: home, t: -1, pr: 0, st: 0, dst: -1, hold: 0 }]
const h = S.A[0]
step(2)
tap(h.rx, h.ry)
ok(S.sel && S.sel.k === 'a', 'the planted warband selects')
ok(/Split/.test(els.pan.innerHTML), 'a resting warband offers Split')
typeIn('sl', 40)
ok(S.split === 40, 'dragging the slider updates the split size')
click('x', 0)
ok(S.A.length === 2 && S.A[0].w + S.A[1].w === 120, 'splitting conserves warriors')
ok(S.A.every(a => a.hold), 'both halves are held apart')
// and they are held apart on the map too: same owner, same kind, same node, so
// without a fan inside the owner's slot the new host lands exactly under the old
S.speed = 0; step(30); S.speed = 1     // paused frames: the ease runs, the board does not
const [u, v] = S.A, hc = S.C[home]
ok(Math.hypot(u.rx - v.rx, u.ry - v.ry) > 20, 'the two halves take separate places around the city')
ok([u, v].every(a => Math.abs(Math.hypot(a.rx - hc.x, a.ry - hc.y) - (cityR(hc) + 17)) < 4),
  'both still ride the ring of their own city')
// node slots and road slots come out of one map, so their keys must not collide:
// city 0 held by realm 1 is not the road 0-1. no edge is needed for this — the
// grouping reads a host's own endpoints, never S.E
const stash = S.A
S.A = [{ id: 5101, o: 1, w: 20, k: 0, a: 0, t: -1, pr: 0, st: 0, dst: -1, hold: 0 },
  { id: 5102, o: 3, w: 20, k: 0, a: 0, t: 1, pr: 0.5, st: 0, dst: -1, hold: 0 }]
step(1, 0)                             // a fresh host is placed outright, no easing
const c0 = S.C[0], ra = (1 - S.me) * 1.2566 + 1.5708, rr = cityR(c0) + 17
ok(Math.hypot(S.A[0].rx - (c0.x + Math.cos(ra) * rr), S.A[0].ry - (c0.y + Math.sin(ra) * rr)) < 4,
  'a lone host keeps its own slot whatever marches the road of the same name')
// and the slot that matters is counted from your own realm, so this holds for all
// five colours: your host rests under the city, where the tip card is not
S.A = [{ id: 5103, o: S.me, w: 20, k: 0, a: 0, t: -1, pr: 0, st: 0, dst: -1, hold: 0 }]
step(1, 0)
ok(S.A[0].ry > c0.y + cityR(c0) && Math.abs(S.A[0].rx - c0.x) < 4,
  'your own host rests directly below the city, whichever realm you took')
S.A = stash

tap(h.rx, h.ry)
tap(S.C[far].x, S.C[far].y)
ok(h.dst === far && h.t >= 0 && h.t !== far, 'mobilizing to a far city sets a multi-hop march')
// the dashed path rides beside the road, not down the middle of it: laid straight
// on the road it was lost in it. 6px to the left of the march, leg by leg
strokes.length = 0; step(1, 0)
const march = strokes.find(([c]) => c === '#e8e4f5aa')
ok(march && march[1].length >= 2, 'the march draws a path of its own')
// measured square to the road, which is the only offset that survives a road of
// any angle — a plain vertical nudge collapses to nothing on a north-south leg
const fr = S.C[h.a], to = S.C[h.t], [px, py] = march[1][1]
const L = Math.hypot(to.x - fr.x, to.y - fr.y)
const off = Math.abs((to.x - fr.x) * (fr.y - py) - (fr.x - px) * (to.y - fr.y)) / L
ok(Math.abs(off - 6) < 0.5, `and it clears the road it follows by 6px (${off.toFixed(1)})`)
step(3)
ok(h.dst === far && h.t >= 0, 'and keeps heading for it leg by leg')

// a fight the player is inside
S.A = [
  { id: 5002, o: 2, w: 100, k: 0, a: home, t: -1, pr: 0, st: 0, dst: -1, hold: 0 },
  { id: 5003, o: 3, w: 100, k: 0, a: home, t: -1, pr: 0, st: 0, dst: -1, hold: 0 }
]
S.speed = 4
step(20)
S.sel = { k: 'a', i: 5002 }
step(2)
// a host in a fight still reports itself — it just cannot be split. This is the
// case that used to answer with a blank panel and read as a bug
ok(/⚔️ Size/.test(els.pan.innerHTML), 'a host in a fight still reports itself')
ok(/Split/.test(els.pan.innerHTML), 'and a fight at a city does not stop you dividing it')
// the road lock is what does. Ticks are stopped for this so the sim cannot clear
// the flag between the write and the render
S.speed = 0
S.A.find(a => a.id === 5002).st = 1; step(1)
ok(!/Split/.test(els.pan.innerHTML), 'but a host locked in a road melee cannot be split')
S.A.find(a => a.id === 5002).st = 0; step(1); S.speed = 4
S.sel = { k: 'a', i: 5003 }; step(1)
ok(/⚔️ Size/.test(els.pan.innerHTML) && !/Split/.test(els.pan.innerHTML),
  'an enemy host reports the same numbers its disc already draws, and no Split')
S.sel = { k: 'a', i: 5002 }; step(1)
const eng = S.A.find(a => a.id === 5002)
ok(eng && eng.eg && eng.eg.length >= 2, 'and the engagement is recorded, so the map can ring it')

// --- the raise badge -------------------------------------------------------
// the map says which of your cities could raise something this instant, so the
// answer does not cost a click on each one. it is your own cities only, and
// canRaise already checks the owner, so there is nothing to leak
const pc = S.C[plain], keep = [S.F[S.me].g, pc.p, pc.mu, pc.oc, pc.u]
S.F[S.me].g = 999; pc.p = 200; pc.mu = pc.oc = pc.u = 0
// badges hang off the disc, so match on where the text landed, not just that it did
const badgeOn = (t, c) => drewAt.some(d =>
  d[0] === t && Math.abs(d[1] - c.x) < 40 && Math.abs(d[2] - c.y) < 40)
const sample = () => { drew.length = drewAt.length = 0; step(1, 0) }   // no elapsed time: no tick runs
sample()
ok(badgeOn('⬆️', pc), 'a city that can raise says so on the map')
S.F[S.me].g = 0
sample()
ok(drew.length > 0 && !drew.includes('⬆️'),
  'with nothing of mine affordable the badge is nowhere — enemy cities never wear it')
S.F[S.me].g = 999; pc.mu = T.muster
sample()
ok(badgeOn('⏳', pc) && !badgeOn('⬆️', pc), 'a city mid-muster wears the hourglass instead')
;[S.F[S.me].g, pc.p, pc.mu, pc.oc, pc.u] = keep

// --- fog of war ------------------------------------------------------------
S.speed = 0                            // freeze the board so the fog is deterministic
S.A = []
S.sel = null
step(2)
const adj = i => S.C[i].n.some(j => S.C[j].o === S.me)
const dark = S.C.findIndex((c, i) => c.o !== S.me && !adj(i))
const near = S.C.findIndex((c, i) => c.o !== S.me && adj(i))
ok(dark >= 0 && near >= 0, 'the map offers both a fogged and a bordering enemy city')

S.sel = { k: 'c', i: dark }; step(1)
ok(/\?\?\?/.test(els.pan.innerHTML), 'a distant city hides its numbers')

S.sel = { k: 'c', i: near }; step(1)
ok(!/\?\?\?/.test(els.pan.innerHTML), 'a city bordering mine reports its numbers')

// populace and walls are the panel's to report — the map used to carry them
// under every city and carries nothing there now
const nc = S.C[near]
ok(els.pan.innerHTML.includes('👥 Militia</span><span>' + (nc.p | 0)),
  'the panel reports the populace')
ok(els.pan.innerHTML.includes('🛡️ Walls</span><span>' + (nc.s | 0) + ' / ' + nc.m),
  'and what is left of the walls, against what they were')
drew.length = 0; step(1)
ok(drew.length > 0 && !drew.some(t => t.includes('👥') || t.includes('🛡') || t.includes('🌫️')),
  'while the map draws nothing at all under the city name')

// scouting is live: present a host, the fog lifts; withdraw, it closes
const scout = { id: 6001, o: 2, w: 50, k: 0, a: dark, t: -1, pr: 0, st: 0, dst: -1, hold: 0 }
S.A = [scout]
S.sel = { k: 'c', i: dark }; step(2)
ok(!/\?\?\?/.test(els.pan.innerHTML), 'a warband standing there lifts the fog')
S.A = []; step(2)
ok(/\?\?\?/.test(els.pan.innerHTML), 'and the fog closes again when it withdraws')

// hosts inside the fog are neither drawn nor clickable
S.A = [{ id: 6002, o: 3, w: 50, k: 0, a: dark, t: -1, pr: 0, st: 0, dst: -1, hold: 0 }]
S.sel = null; step(2)
tap(S.A[0].rx, S.A[0].ry)
ok(!S.sel, 'an enemy host in the fog cannot be selected')
S.A = []; S.speed = 1

// --- fog hides events, not just terrain -----------------------------------
const ticks = n => { S.speed = 8; for (let k = 0; k < n; k++) step(1, 100); S.speed = 1 }
const host = (id, o, at, k = 0) => ({ id, o, w: 120, k, a: at, t: -1, pr: 0, st: 0, dst: -1, hold: 0 })

// effects decay within a few frames, so sample every frame rather than at the end
const watch = (at, n) => {
  let hit = 0
  S.speed = 8
  for (let k = 0; k < n; k++) {
    step(1, 100)
    if (S.fx.some(f => Math.hypot(f.x - S.C[at].x, f.y - S.C[at].y) < 45)) hit = 1
  }
  S.speed = 1
  return hit
}

S.fx = []; S.toast = ''
S.A = [host(7001, 3, dark), host(7002, 4, dark)]
ok(!watch(dark, 20), 'a battle in the fog draws no clash marker')
ok(!S.toast, 'and raises nothing else the player could read')

S.fx = []
S.A = [host(7003, 3, near), host(7004, 4, near)]
ok(watch(near, 20), 'the same battle in sight does draw one')

// the din of battle rides on that marker, so it follows what the player can
// see rather than what the board is doing. sampled while the fight is still
// alive: at 8x a 120-v-120 melee is decided inside the twenty frames above
S.A = []; S.fx = []; step(2)
ok(made[CLASH].paused, 'with no fight on screen the din is quiet')
S.A = [host(7007, 3, near), host(7008, 4, near)]
S.speed = 8; step(2, 100)
ok(!made[CLASH].paused, 'a battle in sight starts it')
// pausing is a still picture — no ticks run, so the fight the marker records is
// not happening either. paused frames cost the board nothing, so this samples
// the same fight rather than staging a second one
S.speed = 0; step(2)
ok(S.fx.some(f => f.k === 1), 'pausing leaves the clash marker on screen')
ok(made[CLASH].paused, 'but the din stops while the game is paused')
S.speed = 8; step(1, 0)   // a frame of no elapsed time: the sim is untouched
ok(!made[CLASH].paused, 'and comes back when the board runs again')

// a backgrounded tab gets no frames, and the loops are reconciled from the
// render loop — so without an event of its own the song and the din play on
// over whatever the player switched to. This spends no frames and no ticks:
// the handler reconciles directly, on the fight already running above
ok(!made[SONG].paused && !made[CLASH].paused, 'both loops are running to begin with')
document.hidden = 1
doc.h.visibilitychange()
ok(made[SONG].paused, 'backgrounding the tab pauses the song')
ok(made[CLASH].paused, 'and the din of battle with it')
document.hidden = 0
doc.h.visibilitychange()
ok(!made[SONG].paused && !made[CLASH].paused, 'coming back brings both of them back')
// `hid` joins the reconcile rather than pausing the elements behind its back,
// and this is the case that tells the two apart: mute() calls play(), so an
// implementation that merely paused on the way out would start the song again
// mid-mute-toggle, playing to a tab nobody is looking at
document.hidden = 1; doc.h.visibilitychange()
mute(); mute()                             // muted and unmuted again, still away
ok(made[SONG].paused, 'a mute toggled while away never starts the song playing to nobody')
document.hidden = 0; doc.h.visibilitychange()
ok(!made[SONG].paused, 'and only coming back does')
S.A = [host(7009, 3, dark), host(7010, 4, dark)]
S.fx = []; step(2, 100)
ok(made[CLASH].paused, 'the same battle in the fog does not')

// --- being attacked is announced ------------------------------------------
const town = S.C.findIndex(c => c.o === S.me)
S.fx = []; S.toast = ''
S.A = [host(7005, 3, town)]
played.length = 0
ticks(4)
ok(/under attack/.test(S.toast), 'an attack on your city raises a notification')
ok(played.filter(i => i === HORN).length === 1,
  'the horn sounds once for it, not once a tick')
ok(!S.fx.some(f => f.k === 1), 'a siege draws no clash marker — there is nobody to fight')
ok(!made[CLASH].paused, 'but the din runs for it all the same')
ok(/under attack/.test(els.toast.innerHTML), 'and the toast renders')
ok(S.C[town].wn === 1, 'the city is flagged so it is not announced twice')

// --- taking a city cows it -------------------------------------------------
const prey = S.C.findIndex((c, i) => c.o !== S.me)
S.C[prey].s = 0.4
S.A = [host(7006, S.me, prey)]
S.C[prey].p = 300
const popWas = S.C[prey].p
ticks(20)
ok(S.C[prey].o === S.me, 'the city is taken')
ok(S.C[prey].p < popWas * 0.6, `the sacking guts its populace (${popWas | 0} -> ${S.C[prey].p | 0})`)
ok(S.C[prey].oc > 0, 'and it is left too cowed to conscript')
S.F[S.me].g = 999
S.sel = { k: 'c', i: prey }; step(1)
ok(/Pacifying<\/button>/.test(els.pan.innerHTML), 'the panel says so')
const before7 = S.A.length
click('r', prey)
ok(S.A.length === before7 && !S.C[prey].mu, 'and raising is refused there')
S.A = []; S.fx = []; S.toast = ''

// --- the panel reports unrest, and only unrest ------------------------------
ok(S.C[prey].u > 0 && els.pan.innerHTML.includes('✊ Unrest</span><span>' + (S.C[prey].u | 0) + '%'),
  `the panel reports the seized city's unrest (${S.C[prey].u | 0}%)`)
ok(!/Loyalty|native|Ionian|Restless/.test(els.pan.innerHTML),
  'and no per-realm loyalty ledger')
S.C[prey].oc = 0; S.C[prey].u = 95; step(1)
ok(/✊ Restless<\/button>/.test(els.pan.innerHTML), 'a restless city says so instead of offering Raise')
S.C[prey].u = 0

// run to a conclusion
S.speed = 8
played.length = 0
for (let i = 0; i < 2200 && !S.over; i++) step(20, 100)
ok(S.over !== 0, 'the game reaches an ending (' + (S.over > 0 ? 'win' : 'loss') + ')')
ok(played.includes(FANFARE) === (S.over > 0), 'the fanfare sounds on a win and only on a win')
ok(made[CLASH].paused, 'and the din stops with the game')
// keyed on the button's action, not its label: `n` is what the click handler
// dispatches on, so re-wording the copy cannot quietly empty this out
ok(/data-a=n/.test(els.ov.innerHTML), 'end screen renders, with the way back on it')
// the campaign is scored in days and in nothing else. Counting the numbers on
// the screen is the assertion a bare "no longer mentions X" cannot make — that
// shape went vacuous here before, the day the string it keyed on was deleted
ok(els.ov.innerHTML.split('<b>').length === 2, 'the end screen carries exactly one number')
ok(/days/.test(els.ov.innerHTML) &&
  els.ov.innerHTML.includes('<b>' + (S.tick / T.day | 0) + '</b><span>days</span>'),
  `and it is the campaign in days (${S.tick / T.day | 0})`)
ok(!/taken|💔|hosts broken|\d+m \d+s/.test(els.ov.innerHTML),
  'with no city tally, no broken hosts and no real-time clock')
ok(/<h1>(Victory|Defeat)<\/h1>/.test(els.ov.innerHTML),
  'and a one-word verdict for a title')
// the campaign is named by the scenario it was fought on — read off SCN rather
// than quoted, so renaming a scenario cannot go stale here
ok(els.ov.innerHTML.includes(SCN[S.scn][0]),
  `and the scenario it was fought on (${SCN[S.scn][0]})`)
// ...but only when the board really is that scenario's. A seed in the URL hash
// overrides the scenario's own on boot, and that is the one case where naming it
// would put a campaign's title on a map it never generated. Without this the
// guard can be deleted and every other end-screen assertion still passes
const realSeed = S.seed
S.seed = 424242; ending()
ok(!els.ov.innerHTML.includes(SCN[S.scn][0]) && /Victory|Defeat/.test(els.ov.innerHTML),
  'and a board a pasted seed generated is not credited to a scenario')
S.seed = realSeed; ending()
const seedWas = S.seed
click('n')
ok(S.over === 0 && S.C.length === 20 && els.ov.innerHTML.includes('Horns of Dominion'), 'restart returns to the title')
ok(S.seed === seedWas && location.hash === '#' + S.seed,
  'restart rebuilds the same scenario and publishes its seed')

// --- the other ending, forced ----------------------------------------------
// a natural run reaches exactly one of the two, so the fanfare check above is
// only ever half a test. take the whole board and the other half runs too
played.length = 0
click('s', S.me)
ok(played.includes(CHIME) && !played.includes(SONG),
  'picking a kingdom chimes, with no song coming up to drown it')
played.length = 0
click('b')
ok(!played.includes(CHIME) && played.includes(SONG),
  'and Start brings the song up instead, which is why it does not chime under it')
step(2)
S.C.forEach(c => { c.o = S.me })
S.fx = [{ x: S.C[0].x, y: S.C[0].y, k: 1, l: 1 }]   // and a fight still on screen
played.length = 0
S.speed = 8
step(4, 100)
ok(S.over > 0, 'holding every city wins')
ok(played.includes(FANFARE), 'and the fanfare sounds for it')
ok(made[CLASH].paused, 'while the din stops even with a clash still drawn')

// --- the camera: a phone fits the height and pans across it ---------------
// Where the board already fits the frame — every landscape frame, so every
// desktop — the new rule is the old min() and the pan clamps to nothing, which
// is what makes this whole change invisible there.
ok(Math.abs(V.s - Math.min(innerWidth / W, innerHeight / H) * 0.92) < 1e-9,
  'a landscape frame scales exactly as it always did')
ok(Math.abs(V.ox - (innerWidth - W * V.s) / 2) < 1e-9 &&
   Math.abs(V.oy - (innerHeight - H * V.s) / 2) < 1e-9,
  'and centres the board the same way')
const oxFit = V.ox, oyFit = V.oy
swipe(W / 2, H / 2, 200, 120)
ok(V.ox === oxFit && V.oy === oyFit,
  'so a drag across it moves nothing — there is nowhere to go, on either axis')
// upward too, and separately: the bottom slack a narrow frame gets is only on
// this bound, so a drag the other way is the only one that can see it leaking
swipe(W / 2, H / 2, 0, -200)
ok(V.oy === oyFit, 'not even upward — a wide frame has no panel along its bottom')

// a phone held upright. Fitting both axes here puts the board at 0.36 and a
// city name at four pixels; the height is what gets fitted instead
const wWas = innerWidth, hWas = innerHeight
globalThis.innerWidth = 390; globalThis.innerHeight = 844
V.s = 0                                    // a fresh frame, not a resize of the old one
win.h.resize()
ok(V.s > Math.min(390 / W, 844 / H) * 2.5,
  `the narrow frame zooms well past the fit (${V.s.toFixed(2)} against ${(Math.min(390 / W, 844 / H) * 0.92).toFixed(2)})`)
ok(H * V.s <= 844, 'the board still fits the height')
ok(W * V.s > 390 * 2, 'and runs off the width, which is what there is to pan')

// a new war on that frame opens over the player's own holdings
click('n'); click('s', 2); click('b'); step(1)
S.speed = 0                                // freeze the board: these are clicks, not ticks
const held = S.C.filter(c => c.o === S.me)
const cx = held.reduce((t, c) => t + c.x, 0) / held.length
const cy = held.reduce((t, c) => t + c.y, 0) / held.length
// what the middle of the frame is looking at
const mid = () => ({ x: (innerWidth / 2 - V.ox) / V.s, y: (innerHeight / 2 - V.oy) / V.s })
ok(Math.abs(mid().x - cx) < 1e-9,
  `the camera opens on the middle of your ${held.length} cities, not the middle of the map`)
ok(Math.abs(cx - W / 2) > 40, `which is somewhere else entirely (${(cx - W / 2).toFixed(0)} units off)`)
// the height fits, so there is no vertical slack to spend: it stays dead centre
// however far north or south your holdings happen to sit
ok(Math.abs(mid().y - H / 2) < 1e-9 && Math.abs(cy - H / 2) > 1,
  'while the axis that fits is pinned centre, wherever those cities are')

// panning: the board slides by exactly what the finger moved, and stops at its edge
const ox0 = V.ox
swipe(200, 400, -120, 0)
ok(Math.abs(V.ox - (ox0 - 120)) < 1e-9, 'a drag slides the board by what the finger moved')
swipe(200, 400, -9999, 0)
ok(Math.abs(V.ox - (innerWidth - W * V.s)) < 1e-9,
  'and it cannot be dragged past its own far edge')
swipe(200, 400, 9999, 0)
ok(Math.abs(V.ox) < 1e-9, 'nor past the near one')

// the bottom of a narrow frame has the panel on it, so the board must be
// draggable up out from under it. Without the slack this axis has no travel at
// all — the board fits the height — and a city behind the panel is unreachable
const oyRest = V.oy
swipe(200, 400, 0, -300)
ok(Math.abs(V.oy - (oyRest - 300)) < 1e-9, 'the board lifts out from under the bottom panel')
swipe(200, 400, 0, -9999)
ok(Math.abs(V.oy - (oyRest - innerHeight / 2)) < 1e-9,
  'by half a screen of slack, and no further')
swipe(200, 400, 0, 9999)
ok(Math.abs(V.oy - oyRest) < 1e-9, 'and cannot be dragged back down past its resting place')

// and the drag is not a click: the same spot taken slowly does select
const lone = S.C.findIndex(c => !S.A.some(a => Math.hypot(a.rx - c.x, a.ry - c.y) < 20))
S.sel = null
// the drag has to *end* on the city, or a stray click would miss it anyway and
// the assertion would pass without testing anything. The height fits, so this
// vertical drag is clamped to no movement and the release lands on the disc
swipe(S.C[lone].x, S.C[lone].y + 140 / V.s, 0, -140)
ok(S.sel === null, 'a drag that ends on a city selects nothing — it is a pan')
tap(S.C[lone].x, S.C[lone].y)
ok(S.sel && S.sel.k === 'c' && S.sel.i === lone, 'the same city tapped does select')

globalThis.innerWidth = wWas; globalThis.innerHeight = hWas
V.s = 0; win.h.resize()

console.log(fail ? '\nFAILURES' : '\nall good')
process.exit(fail)
