import { S, T, D } from './state.js'
import { REALMS, SCN } from './map.js'
import { mute, muted, chime } from './audio.js'
import { raise, split, canRaise, canSplit, getArmy, seeCity, tired, active } from './sim.js'

// the calendar. 13 months of 28 days, so a year is 364 and the whole date is one
// number — S.tick over T.day. Nothing stored, nothing to reset between games.
const MON = 'Auriel Florin Rainmere Verdant Solara Lumin Hearth Aureon Fallow Mistral Ember Frost Lunaris'.split(' ')
const days = () => S.tick / T.day | 0
// the suffix only ever has to be right for 1 to 28, which is why % 20 is enough
const ord = d => d + (d % 20 === 1 ? 'st' : d % 20 === 2 ? 'nd' : d % 20 === 3 ? 'rd' : 'th')
// the campaign's own days are the score; the scenario's first day only shifts
// what the calendar calls them
// any day since the epoch, spelled out — the hud asks for today, a scenario card
// asks for the day it opens on
const at = d => `${MON[d % 364 / 28 | 0]} ${ord(d % 28 + 1)}, year ${13312 + (d / 364 | 0)}`
// the age rides in its own span so a narrow hud can drop it: the day and the
// year fit a phone across, the whole style of it does not
const date = () => at(days() + S.d0) + '<span class=ag> of the Mazurian Age</span>'

const $ = id => document.getElementById(id)
const hud = $('hud'), pan = $('pan'), ov = $('ov'), ts = $('toast'), tip = $('tip')
export const hooks = {}
const set = (el, h) => { if (el._h !== h) { el._h = h; el.innerHTML = h } }
const btn = (a, i, on, txt) => `<button data-a=${a} data-i=${i}${on ? '' : ' disabled'}>${txt}</button>`

// Onboarding: seven tips under the hud. Which one shows is read off the board,
// like the fog and the command — S.tut only remembers how far you got, so the
// sequence cannot run backwards and knows when the last act is done.
// `$` in a tip is the player's own realm marker, which is how the rest of the
// game says "yours" — the hud wears the same glyph beside the realm name.
export const TIP = ['Tap one of YOUR cities<br>(colored $)',
  'Tap the "Raise" button to muster a warband',
  'Wait for your unit to muster', 'Tap the new unit by the city',
  'Tap an enemy city to march on it', 'Tap anywhere else to unselect',
  'Conquer all cities to win!']
function tut () {
  // no city of your own left is the end of the tutorial, not no *capital*: the
  // sequence stopped naming the capital, so it stopped depending on holding one
  if (S.over || ov.innerHTML || S.tut > 6 || !S.C.some(c => c.o === S.me)) return set(tip, '')
  const a = active()
  // step 1 asks for a city and takes any city — picking the "wrong" one used to
  // leave the player staring at the same instruction they had just followed.
  // Step 2 is the same rule one move on: any muster of yours, not the capital's
  const d = a ? (a.t < 0 ? 4 : 5)
    : S.A.some(x => x.o === S.me) ? 3
    : S.C.some(c => c.o === S.me && c.mu) ? 2
    : S.sel && S.sel.k === 'c' ? 1 : 0
  if (d > S.tut) S.tut = d                 // the furthest point reached, for the ending
  if (S.tut > 4 && !a) S.tut = 6              // the host stood down: on to the last word
  // the card sits where the toast does — under the hud, centred — and CSS puts
  // it there. It used to be positioned from the capital's world coordinates
  // every frame, which meant it moved with the camera, could be panned off the
  // screen, and needed the capital to be on screen at all to be read
  set(tip, `${TIP[S.tut > 5 ? 6 : d].replace('$', S.F[S.me].em)}<a data-a=z>dismiss</a>`)
}

export function ui () {
  tut()
  if (S.over || !S.F.length) return
  const F = S.F[S.me]
  set(hud, `<span style=color:${F.c}>${F.em} <b>${F.nm}</b></span>` +
    `<span>💎 <b>${F.g | 0}</b></span>` +
    `<span class=dt><b>${date()}</b></span>` +   // .dt takes the slack: the date rides right, by the buttons
    `<div class=sp><button data-a=q>${muted ? '🔇' : '🔊'}</button>` +
    `${[0, 1, 2, 4, 8].map(v =>
      `<button data-a=v data-i=${v} class="${S.speed === v ? 'on' : ''}">${v ? v + '×' : '⏸'}</button>`).join('')}</div>`)

  set(ts, S.toast ? `<div>${S.toast}</div>` : '')

  const s = S.sel
  if (!s) return set(pan, '')
  if (s.k === 'c') {
    const c = S.C[s.i], own = c.o === S.me, lit = seeCity(s.i)
    const q = '<span style=opacity:.45>???</span>'
    set(pan, `<h3>${lit && c.cap ? '👑' : '🏰'} ${c.nm}</h3>` +
      row('👥 Militia', lit ? c.p | 0 : q) +
      row('🛡️ Walls', lit ? (c.s | 0) + ' / ' + c.m : q) +
      row('⚔️ Defense', lit ? c.d : q) +
      row('💎 Economy', lit ? c.e : q) +
      row('✊ Unrest', lit ? (c.u | 0) + '%' : q) +
      (own
        ? `<div class=acts>${btn('r', s.i, canRaise(s.i, S.me), c.oc
            ? `⚔️ Pacifying`
            : c.u >= T.calm
              ? `✊ Restless`
              : c.mu
              ? `⏳ Mustering ${(100 - c.mu / T.muster * 100) | 0}%`
                : `${T.K[0][5]} Raise ${T.raiseW} — 💎${T.K[0][3]} 👥${T.K[0][4]}`)}` +
          `${c.sp ? btn('g', s.i, canRaise(s.i, S.me, c.sp),
            `${T.K[c.sp][5]} Raise ${T.raiseW} — 💎${T.K[c.sp][3]} 👥${T.K[c.sp][4]}`) : ''}</div>`
        : ''))
    return
  }

  const a = getArmy(s.i)
  if (!a) { S.sel = null; return set(pan, '') }
  // what the map cannot say: how spent the host is, and what its kind is for.
  // Every host you can select is one you can already see, and its bodies and its
  // fatigue ring are drawn on the disc, so an enemy's card leaks nothing new.
  // A multiplier of 1 is the footman baseline and prints no row at all.
  const K = T.K[a.k], sp = K[2]
  set(pan, `<h3>${K[5]} ${K[6]}</h3>` +
    row('⚔️ Size', a.w | 0) +
    row('💤 Stamina', '<b id=st></b>') +
    mult('💥 Field', K[0]) + mult('🧱 Siege', K[1]) + mult('🐾 March', sp) +
    mult('🏹 Ambush', +(1 + (sp - 1) * T.amb).toFixed(2)) +
    (a.o === S.me && canSplit(a)
      ? `<div class=acts><div class=sr><input type=range id=sl><b id=slv></b></div>` +
        `${btn('x', 0, 1, '✂️ Split')}</div>`
      : ''))
  sync(a)
}

// the slider is kept OUT of the diffed string on purpose — writing its value
// imperatively means dragging never rewrites the panel underneath the drag
function sync (a) {
  const st = $('st')
  if (st) st.textContent = 100 - (a.fg | 0) + '%' + (tired(a) ? ' — winded' : '')
  const sl = $('sl')
  if (!sl) return
  const max = Math.floor(a.w) - 1
  sl.min = 1; sl.max = max
  if (!(S.split >= 1) || S.split > max) S.split = Math.max(1, Math.round(max / 2))
  if (document.activeElement !== sl) sl.value = S.split
  const v = $('slv')
  if (v) v.textContent = S.split + ' of ' + (a.w | 0)
}

const row = (k, v) => `<div class=r><span>${k}</span><span>${v}</span></div>`
// a kind's edge over a footman, and nothing where it has none
const mult = (k, v) => v === 1 ? '' : row(k, '×' + v)

export function title () {
  ov.innerHTML = `<h1>Horns of Dominion</h1>` +
    `<h2>SCENARIO</h2>` +
    `<div class=realms>${SCN.map(([nm, sd, d0], i) =>
      `<div class="realm${S.scn === i ? ' on' : ''}" data-a=c data-i=${i}>` +
      `<div class=e>${'I'.repeat(i + 1)}</div><div class=n>${nm}</div><div class=c>${at(d0)}</div></div>`).join('')}</div>` +
    `<h2>KINGDOM</h2>` +
    `<div class=realms>${REALMS.map(([nm, c, em], i) =>
      `<div class="realm${S.me === i ? ' on' : ''}" data-a=s data-i=${i} style=color:${c}><div class=e>${em}</div><div class=n>${nm}</div></div>`).join('')}</div>` +
    `<h2>DIFFICULTY</h2>` +
    `<div class=diff>${D.map((d, i) =>
      `<button data-a=d data-i=${i} class="${S.diff === i ? 'on' : ''}">${d.nm}</button>`).join('')}</div>` +
    `<button data-a=b>⚔️ Start</button>`
}

// one word, one number: the campaign is scored in the days it took and nothing
// else. Real time was never the game's own clock, and a tally of cities and
// broken hosts said what the board had already shown for the whole war
export function ending () {
  ov.innerHTML = `<h1>${S.over > 0 ? 'Victory' : 'Defeat'}</h1>` +
    `<p>${S.F[S.me].em} ${S.F[S.me].nm} · ${D[S.diff].nm}</p>` +
    `<div class=tally><b>${days()}</b><span>days</span></div>` +
    `<button data-a=n>Back</button>`
}
export const clearOv = () => { ov.innerHTML = '' }

addEventListener('input', e => {
  if (!e.target || e.target.id !== 'sl') return
  S.split = +e.target.value
  const v = $('slv')
  if (v) v.textContent = S.split
})

addEventListener('click', e => {
  const el = e.target.closest('[data-a]')
  if (!el) return
  const a = el.dataset.a, i = +el.dataset.i
  // every button that commits to something. not the realm card: the song comes
  // up over it and the chime is inaudible under it
  if ('rgxdvsc'.includes(a)) chime()
  if (a === 'r') raise(i, S.me)
  else if (a === 'g') raise(i, S.me, S.C[i].sp)
  else if (a === 'x') split(getArmy(S.sel && S.sel.i), S.split)
  else if (a === 'q') mute()
  else if (a === 'v') S.speed = i
  else if (a === 'd') { S.diff = i; title() }
  else if (a === 'c') { S.scn = i; hooks.again() }   // a new age: rebuild the board under the title
  else if (a === 'b') hooks.start(S.me)             // the kingdom is chosen; this commits
  else if (a === 'z') S.tut = 7                     // done with the tips
  else if (a === 's') { S.me = i; title() }
  else if (a === 'n') hooks.again()
  ui()
})
