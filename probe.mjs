// The player's actual situation, which no existing harness measures: realm 0 on
// Duelist, the other four on the rung under test. diff-test measures the inverse
// (one realm on the rung against four Duelists) and sim-test puts all five on the
// same rung. Neither answers "can a Duelist survive four Warlords", which is what
// the report is about. Realm 0 is an AI standing in for the player.
// Also reports the thing actually complained about: how big enemy hosts get.
import { S, WIN, D } from './src/state.js'
import { genMap } from './src/map.js'
import { tick, cnt } from './src/sim.js'
import { ai } from './src/ai.js'

const rung = +process.argv[2] || 2
const N = +process.argv[3] || 200
const base = +process.argv[4] || 3000
let wins = 0, lens = [], stuck = 0, big = [], tot = []
for (let g = 0; g < N; g++) {
  genMap(base + g)
  S.me = 0
  S.F.forEach((f, i) => { f.ai = 1; f.dm = D[i === 0 ? 1 : rung] })
  let t = 0, peak = 0, peakTot = 0
  for (; t < 120000; t++) {
    tick(); ai(); S.over = 0
    if (!(t % 200)) {                       // sample rather than scan every tick
      let mx = 0, sum = 0
      for (const a of S.A) if (a.o !== 0) { if (a.w > mx) mx = a.w; sum += a.w }
      if (mx > peak) peak = mx
      if (sum > peakTot) peakTot = sum
    }
    if (S.F.some((f, i) => cnt(i) >= WIN)) break
  }
  if (cnt(0) >= WIN) wins++
  if (S.F.some((f, i) => cnt(i) >= WIN)) lens.push(t); else stuck++
  big.push(peak); tot.push(peakTot)
}
const q = (arr, p) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(s.length * p))] | 0 }
console.log(`rung ${D[rung].nm} (cap ${D[rung].cap} inc ${D[rung].inc} acts ${D[rung].acts})  ${N} games from seed ${base}`)
console.log(`  realm 0 (Duelist) wins ${wins}/${N} = ${(wins / N * 100).toFixed(1)}%   stalemate ${stuck}`)
console.log(`  biggest enemy host   p50 ${q(big, .5)}  p90 ${q(big, .9)}  max ${q(big, 1)}`)
console.log(`  enemy warriors total p50 ${q(tot, .5)}  p90 ${q(tot, .9)}  max ${q(tot, 1)}`)
console.log(`  ticks p50 ${q(lens, .5)}  p90 ${q(lens, .9)}`)
