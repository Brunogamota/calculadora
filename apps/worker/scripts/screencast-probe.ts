/**
 * Mede a captura de frames de verdade (§7.1).
 *
 *   npm run screencast                    (loja falsa local, sem rede)
 *   npm run screencast -- https://loja    (site real)
 *   npm run screencast -- --seconds 20 --quality 40
 *
 * Serve para calibrar qualidade e `everyNthFrame` contra o alvo da §7.1: 5 a 10
 * frames por segundo. Acima disso o ganho visual é pequeno e a banda sobe
 * rápido — e banda é o que decide se a transmissão ao vivo aguenta.
 */

import { chromium } from 'playwright'
import { startScreencast } from '../src/stream/screencast.ts'
import { MemoryPublisher } from '../src/stream/publisher.ts'
import { startFakeStore } from '../test/fixtures/fake-shopify.ts'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'
import { normalizeUrl, assertUrlShapeIsSafe } from '../src/lib/guards.ts'

const args = process.argv.slice(2)
const flag = (name: string, fallback: number): number => {
  const i = args.indexOf(`--${name}`)
  if (i === -1) return fallback
  const value = Number(args[i + 1])
  return Number.isFinite(value) ? value : fallback
}

const alvo = args.find((a) => !a.startsWith('--') && !/^\d+$/.test(a))
const segundos = flag('seconds', 10)
const quality = flag('quality', 60)
const everyNthFrame = flag('every-nth', 2)
const maxFps = flag('max-fps', 8)

// Loja falsa quando nenhum alvo é dado: mede sem tocar em site de ninguém.
let fake: Awaited<ReturnType<typeof startFakeStore>> | null = null
let url: string
if (alvo) {
  const normalized = normalizeUrl(alvo)
  assertUrlShapeIsSafe(normalized)
  url = normalized.href
} else {
  process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
  fake = await startFakeStore()
  url = `${fake.url}/animado`
}

const browser = await chromium.launch({ headless: !process.argv.includes('--headed') })
const page = await browser.newPage({
  viewport: { width: 1280, height: 720 },
  userAgent: DEFAULT_USER_AGENT,
})

console.log(`alvo:     ${url}`)
console.log(`gravando: ${segundos}s  quality=${quality}  everyNthFrame=${everyNthFrame}  maxFps=${maxFps}\n`)

await page.goto(url, { waitUntil: 'domcontentloaded' })
const bus = new MemoryPublisher()
const cast = await startScreencast(page, bus, 'probe', { quality, everyNthFrame, maxFps })
await page.waitForTimeout(segundos * 1000)
const stats = await cast.stop()

await browser.close()
await fake?.close()

const kbPorFrame = stats.framesPublished === 0 ? 0 : stats.bytesTotal / stats.framesPublished / 1024
const kbPorSegundo = stats.bytesTotal / 1024 / (stats.durationMs / 1000)

console.log(`frames recebidos   ${stats.framesReceived}`)
console.log(`frames publicados  ${stats.framesPublished}`)
console.log(`frames limitados   ${stats.framesThrottled}  (acked, não publicados)`)
console.log(`frames descartados ${stats.framesDropped}`)
console.log(`falhas de ack      ${stats.ackFailures}`)
console.log(`taxa               ${stats.fps} fps`)
console.log(`tamanho médio      ${kbPorFrame.toFixed(1)} KB/frame`)
console.log(`banda              ${kbPorSegundo.toFixed(0)} KB/s  (${(kbPorSegundo * 8 / 1024).toFixed(1)} Mbps)`)

const alvoDaSpec = stats.fps >= 5 && stats.fps <= 10
console.log(`\nalvo da §7.1 (5-10 fps): ${alvoDaSpec ? 'dentro' : 'FORA'}`)
if (stats.ackFailures > 0) {
  console.log('ATENÇÃO: houve falha de ack. Sem ack o Chrome emudece depois de alguns frames.')
}
