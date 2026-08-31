/**
 * §7.1 — captura de frames por CDP.
 *
 * O teste central aqui é o do `screencastFrameAck`. Sem o ack, o Chrome envia
 * três ou quatro frames e emudece — e num teste curto isso passa por
 * funcionando. Por isso a asserção é sobre QUANTIDADE ao longo do tempo, não
 * sobre "chegou algum frame".
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { chromium, type Browser, type Page } from 'playwright'
import { startScreencast, type ScreencastStats } from '../../src/stream/screencast.ts'
import { MemoryPublisher } from '../../src/stream/publisher.ts'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'
import type { AuditEvent } from '@raio-x/types'

const DURACAO_MS = 4000

describe('screencast por CDP', { concurrency: false }, () => {
  let store: FakeStore
  let browser: Browser
  let page: Page
  let bus: MemoryPublisher
  let recebidos: AuditEvent[]
  let stats: ScreencastStats

  before(async () => {
    store = await startFakeStore()
    browser = await chromium.launch({ headless: true })
    page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    await page.goto(`${store.url}/animado`)

    bus = new MemoryPublisher()
    recebidos = []
    bus.subscribe('a1', (e) => recebidos.push(e))

    const cast = await startScreencast(page, bus, 'a1')
    await page.waitForTimeout(DURACAO_MS)
    stats = await cast.stop()
  })

  after(async () => {
    await browser.close()
    await store.close()
  })

  test('o ack mantém o fluxo vivo: muitos frames, não três', () => {
    // Sem screencastFrameAck o Chrome para depois de alguns frames. Esta é a
    // asserção que detecta isso — e a razão de o teste durar segundos.
    assert.ok(
      stats.framesReceived > 10,
      `só ${stats.framesReceived} frames em ${DURACAO_MS}ms: sinal clássico de ack faltando`,
    )
  })

  test('nenhuma falha de ack', () => {
    assert.equal(stats.ackFailures, 0)
  })

  test('a taxa publicada fica na faixa da §7.1 (5 a 10 fps)', () => {
    // Medido antes do teto por tempo: everyNthFrame=2 numa página animada dava
    // 29,7 fps e 2,1 Mbps por espectador. everyNthFrame divide a taxa do
    // compositor, não limita a taxa de saída.
    assert.ok(stats.fps >= 5, `fps abaixo do alvo: ${stats.fps}`)
    assert.ok(stats.fps <= 10, `fps acima do alvo: ${stats.fps}`)
  })

  test('o Chrome ofereceu bem mais frames do que publicamos', () => {
    assert.ok(
      stats.framesThrottled > stats.framesPublished,
      `limitados ${stats.framesThrottled}, publicados ${stats.framesPublished}`,
    )
  })

  test('frame limitado também é ackado: o fluxo não pode morrer', () => {
    // Se o ack só acontecesse no frame publicado, o Chrome emudeceria e
    // framesReceived ficaria perto de framesPublished.
    assert.ok(stats.framesReceived > stats.framesPublished * 2)
    assert.equal(stats.ackFailures, 0)
  })

  test('a banda por espectador fica abaixo de 1 Mbps', () => {
    const kbPorSegundo = stats.bytesTotal / 1024 / (stats.durationMs / 1000)
    const mbps = (kbPorSegundo * 8) / 1024
    assert.ok(mbps < 1, `${mbps.toFixed(1)} Mbps por espectador é caro demais para a §7.4`)
  })

  test('os frames chegam ao barramento com sequência crescente', () => {
    const frames = recebidos.filter((e) => e.type === 'frame')
    assert.ok(frames.length > 10, `só ${frames.length} frames`)
    const seqs = frames.map((f) => (f.type === 'frame' ? f.seq : -1))
    // A sequência conta o que foi PUBLICADO, sem buracos: o front não deve ver
    // salto de 1 para 30 só porque limitamos a taxa.
    for (let i = 0; i < seqs.length; i++) {
      assert.equal(seqs[i], i + 1, 'sequência dos publicados deve ser contínua')
    }
  })

  test('frame vem como base64 com tamanho plausível', () => {
    const primeiro = recebidos.find((e) => e.type === 'frame')
    assert.ok(primeiro && primeiro.type === 'frame')
    assert.ok(primeiro.data.length > 1000, 'frame pequeno demais para ser uma tela')
    assert.match(primeiro.data.slice(0, 40), /^[A-Za-z0-9+/]+$/, 'esperado base64')
  })

  test('parar duas vezes não quebra e devolve as mesmas contas', async () => {
    const bus2 = new MemoryPublisher()
    const cast = await startScreencast(page, bus2, 'a2')
    const um = await cast.stop()
    const dois = await cast.stop()
    assert.equal(um.framesReceived, dois.framesReceived)
  })

  test('depois de parar, nada mais é publicado', async () => {
    const bus3 = new MemoryPublisher()
    const publicados: AuditEvent[] = []
    bus3.subscribe('a3', (e) => publicados.push(e))
    const cast = await startScreencast(page, bus3, 'a3')
    await page.waitForTimeout(600)
    await cast.stop()
    const antes = publicados.length
    await page.waitForTimeout(600)
    assert.equal(publicados.length, antes, 'frame publicado depois do stop')
  })
})
