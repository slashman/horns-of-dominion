import * as esbuild from 'esbuild'
import { Packer } from 'roadroller'
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync, statSync } from 'fs'
import { execSync } from 'child_process'
import { crc32, deflateRawSync } from 'zlib'
import zopfli from '@gfx/zopfli'
import http from 'http'

const LIMIT = 13312
const DEV = process.argv.includes('--dev')
const QUIET = process.argv.includes('--quiet')
const RAW = process.argv.includes('--raw')     // skip roadroller, to compare

function minifyHtml (h) {
  return h
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/\n\s*/g, '')
    .trim()
}

function minifyCss (c) {
  return c
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s*([{}:;,>])\s*/g, '$1')
    .replace(/;}/g, '}')
    .replace(/\s+/g, ' ')
    .trim()
}

// esbuild does not mangle property names, and roadroller does not make long ones
// free: renaming ours is worth ~316 B — more than every feature cut that was on
// the table put together — and it costs nothing in the source, because the
// rename happens here and `src/` stays as readable as it was.
//
// It is an ALLOWLIST and it has to be. Mangling renames a property everywhere in
// the bundle, so a name that is *also* a builtin or a DOM property breaks the
// moment our renamed access lands on an object we do not own: `split` was in the
// first draft and turned "a b c".split(' ') into .D(). A name belongs here only
// if nothing outside our own objects answers to it.
//
// `dist-test` is what proves that, and it is the only thing that can: it is the
// one harness that runs the packed bundle, and it now plays a whole war with the
// audio running, so every property here is exercised. It fails on `split`, on
// `sort` and on `dataset` being added to this list — all three were tried.
const MINE = [
  // state.js — the T balance surface
  'inc', 'grow', 'raiseW', 'muster', 'speed', 'reach', 'atk', 'sgLoss', 'sgDmg',
  'garrison', 'sack', 'occupy', 'mend', 'flee', 'odds', 'aiHoard', 'aiEvery', 'aiCap',
  'bold', 'dying', 'escal', 'day', 'slow', 'stir', 'pace', 'hold',
  'seize', 'calm', 'riot', 'rise', 'sp', 'tread', 'brawl', 'rest', 'wind', 'amb', 'home',
  'wing',
  // state.js — S, and the difficulty rungs
  'fx', 'me', 'sel', 'tick', 'over', 'seed', 'scn', 'd0', 'tut', 'elapsed', 'alpha',
  'toast', 'toastT', 'diff', 'nm', 'acts', 'cap', 'pac', 'alive', 'dm', 'ai', 'em',
  // map.js — a city
  'na', 'mu', 'oc', 'wn',
  // sim.js — a warband
  'pr', 'st', 'dst', 'eg', 'sg', 'fg', 'rx', 'ry',
  // render.js — the camera
  'ox', 'oy', 'lo',
  // song.js / sfx.js — SoundBox fields, read by player.js
  'songData', 'rowLen', 'patternLen', 'endPattern', 'numChannels',
  // player.js's own methods, and main.js's two hooks. NOT `size` — that is a
  // Map's, and `play`/`pause`/`loop`/`currentTime` are an Audio element's
  'init', 'generate', 'createWave', 'start', 'again'
]

async function bundle () {
  const out = await esbuild.build({
    entryPoints: ['src/main.js'],
    bundle: true,
    minify: !DEV,
    format: 'iife',
    target: 'es2020',
    write: false,
    legalComments: 'none',
    mangleProps: new RegExp('^(' + MINE.join('|') + ')$')
  })
  return out.outputFiles[0].text
}

// Roadroller re-encodes the bundle as a self-extracting payload. It costs a
// couple of seconds of search, so dev builds skip it — they are already
// unminified and their size means nothing anyway.
async function pack (js) {
  if (DEV || RAW) return js
  const p = new Packer([{ data: js, type: 'js', action: 'eval' }], {})
  await p.optimize(1)
  const { firstLine, secondLine } = p.makeDecoder()
  return firstLine + secondLine
}

// Info-ZIP writes 170 B of container and its deflate lags zlib's by ~200 B, so
// the archive is assembled here instead: one entry, no extra fields, and zopfli
// doing the deflate. Everything a js13k submission needs and nothing else.
let zipHow = ''
async function zipOne (name, data) {
  let body
  try {
    body = await zopfli.deflateAsync(data, { numiterations: 60 })
    zipHow = 'hand-rolled, zopfli'
  } catch {
    body = deflateRawSync(data, { level: 9 })
    zipHow = 'hand-rolled, zlib -9 (zopfli unavailable)'
  }
  const nm = Buffer.from(name)
  const head = (sig, extra) => {
    const b = Buffer.alloc(extra ? 46 : 30)
    b.writeUInt32LE(sig, 0)
    let o = extra ? 6 : 4
    if (extra) b.writeUInt16LE(20, 4)          // version made by
    b.writeUInt16LE(20, o); b.writeUInt16LE(0, o + 2)      // version needed, flags
    b.writeUInt16LE(8, o + 4)                              // deflate
    b.writeUInt16LE(0, o + 6); b.writeUInt16LE(33, o + 8)  // 1980-01-01, fixed so builds match
    b.writeUInt32LE(crc32(data), o + 10)
    b.writeUInt32LE(body.length, o + 14)
    b.writeUInt32LE(data.length, o + 18)
    b.writeUInt16LE(nm.length, o + 22)
    return b
  }
  const lfh = head(0x04034b50, 0)
  const cdh = head(0x02014b50, 1)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10)
  eocd.writeUInt32LE(cdh.length + nm.length, 12)
  eocd.writeUInt32LE(lfh.length + nm.length + body.length, 16)
  return Buffer.concat([lfh, nm, body, cdh, nm, eocd])
}

async function build () {
  const css = readFileSync('src/style.css', 'utf8')
  const fold = !DEV && !RAW              // stylesheet inside the packed payload?
  let bundled = await bundle()
  if (fold) {
    bundled = 'document.head.appendChild(document.createElement("style")).innerHTML=' +
      JSON.stringify(minifyCss(css)) + ';' + bundled
  }
  const js = await pack(bundled)
  let html = readFileSync('src/index.html', 'utf8')
  if (!DEV) html = minifyHtml(html)
  html = html
    .replace('/*CSS*/', fold ? 'body{background:#0b0a12}' : (DEV ? css : minifyCss(css)))
    .replace('/*JS*/', () => js)

  mkdirSync('dist', { recursive: true })
  writeFileSync('dist/index.html', html)

  const raw = Buffer.byteLength(html)
  rmSync('dist/game.zip', { force: true })
  writeFileSync('dist/game.zip', await zipOne('index.html', Buffer.from(html)))
  const zipped = statSync('dist/game.zip').size
  const left = LIMIT - zipped
  const pct = ((zipped / LIMIT) * 100).toFixed(1)

  if (!QUIET) {
    console.log(`  raw    ${raw.toLocaleString()} B` +
      (DEV || RAW ? '' : '  (roadroller-packed)'))
    console.log(`  zip    ${zipHow}`)
    console.log(`  zipped ${zipped.toLocaleString()} B / ${LIMIT.toLocaleString()} B  (${pct}%)`)
    console.log(left >= 0 ? `  headroom ${left.toLocaleString()} B` : `  OVER BUDGET by ${(-left).toLocaleString()} B`)
  } else {
    console.log(`${zipped} / ${LIMIT} (${pct}%)`)
  }
  return left
}

if (DEV) {
  const ctx = await esbuild.context({
    entryPoints: ['src/main.js'],
    bundle: true,
    write: false,
    format: 'iife',
    target: 'es2020',
    plugins: [{
      name: 'rebuild-html',
      setup (b) {
        b.onEnd(async () => {
          try { await build(); console.log('  rebuilt', new Date().toTimeString().slice(0, 8)) } catch (e) { console.error(e.message) }
        })
      }
    }]
  })
  await ctx.watch()
  http.createServer((req, res) => {
    const p = req.url === '/' ? 'dist/index.html' : 'dist' + req.url.split('?')[0]
    if (!existsSync(p)) { res.writeHead(404); return res.end('nope') }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
    res.end(readFileSync(p))
  }).listen(8080)
  console.log('  dev  http://localhost:8080')
} else {
  const left = await build()
  process.exit(left >= 0 ? 0 : 1)
}
