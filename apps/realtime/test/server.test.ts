/**
 * §7.4 — canal de tempo real.
 *
 * A regra que mais importa aqui: quem reconecta recebe o ESTADO DOS PASSOS,
 * nunca o histórico de frames. Sem essa distinção, uma reconexão despejaria
 * megabytes de JPEG que já passaram.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { WebSocket } from 'ws'
import { startFakeStore, type FakeStore } from '../../worker/test/fixtures/fake-shopify.ts'

const PORT = 4287
process.env['PORT'] = String(PORT)
process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['RAIO_X_SEGREDO_TITULARIDADE'] ??= 'segredo-de-teste-com-tamanho-suficiente'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
process.env['RAIO_X_QUIET'] = '1'

const base = `http://localhost:${PORT}`

/* `consentido` porque estes exercícios percorrem a jornada inteira, e a loja é
   a falsa deste repositório: o aceite existe de verdade. O modo vai explícito
   porque a API recusa sem ele — e essa recusa tem exercício próprio abaixo. */
const ACEITE_DE_TESTE = {
  em: '2026-09-01T00:00:00.000Z',
  texto: 'Loja falsa deste repositório: a auditoria é autorizada por quem a escreveu.',
}

async function pedirAuditoria(
  url: string,
  extra: Record<string, unknown> | null = null,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const corpo =
    extra ?? { url, modo: 'consentido', aceite: { ...ACEITE_DE_TESTE, url } }
  const res = await fetch(`${base}/api/audit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(corpo),
  })
  return { status: res.status, body: (await res.json()) as Record<string, unknown> }
}

/** Escuta a sala até `complete`/`aborted` ou o tempo acabar. */
function ouvir(auditId: string, timeoutMs = 60_000): Promise<Record<string, unknown>[]> {
  return new Promise((resolve) => {
    const eventos: Record<string, unknown>[] = []
    const ws = new WebSocket(`ws://localhost:${PORT}/live?auditId=${auditId}`)
    const encerrar = (): void => {
      ws.close()
      resolve(eventos)
    }
    ws.on('message', (raw) => {
      const e = JSON.parse(String(raw)) as Record<string, unknown>
      eventos.push(e)
      if (e['type'] === 'complete' || e['type'] === 'aborted') setTimeout(encerrar, 150)
    })
    ws.on('error', encerrar)
    setTimeout(encerrar, timeoutMs)
  })
}

describe('servidor de tempo real', { concurrency: false }, () => {
  let store: FakeStore
  let eventos: Record<string, unknown>[]
  let auditId: string

  let encerrar: () => Promise<void>

  before(async () => {
    /* Publica a etiqueta porque estes exercícios rodam em modo consentido, que
       agora exige prova de titularidade (`lib/titularidade.ts`). A recusa sem
       etiqueta tem exercício próprio, mais abaixo. */
    store = await startFakeStore({ titularidadeVerificada: true })
    const servidor = await import('../src/server.ts')
    encerrar = servidor.closeServer
    await new Promise((r) => setTimeout(r, 400))

    const pedido = await pedirAuditoria(store.url)
    auditId = String(pedido.body['auditId'])
    eventos = await ouvir(auditId)
  })

  after(async () => {
    await encerrar()
    await store.close()
  })

  test('POST /api/audit devolve auditId e aceita em background', () => {
    assert.match(auditId, /^audit_/)
  })

  test('os passos chegam na ordem da §7.3', () => {
    const inicios = eventos.filter((e) => e['type'] === 'step:start').map((e) => e['id'])
    assert.deepEqual(inicios, ['identify', 'open-product', 'add-to-cart', 'reach-checkout', 'read-payment', 'report'])
  })

  test('a etapa mobile sai como skip, não como falha', () => {
    const mobile = eventos.find((e) => e['id'] === 'mobile')
    assert.equal(mobile?.['type'], 'step:skip')
  })

  test('achados aparecem DURANTE a execução, antes do complete', () => {
    const achados = eventos.findIndex((e) => e['type'] === 'finding')
    const completo = eventos.findIndex((e) => e['type'] === 'complete')
    assert.ok(achados !== -1, 'nenhum achado transmitido')
    assert.ok(achados < completo, 'achado precisa chegar antes do fim')
  })

  test('complete traz nota e ressalva juntas', () => {
    const completo = eventos.find((e) => e['type'] === 'complete')
    assert.ok(completo)
    assert.ok('score' in completo && 'caveat' in completo)
  })

  test('frames atravessam o fio', () => {
    assert.ok(eventos.some((e) => e['type'] === 'frame'), 'nenhum frame transmitido')
  })

  test('GET /api/audit/:id devolve o estado dos passos', async () => {
    const res = await fetch(`${base}/api/audit/${auditId}`)
    const estado = (await res.json()) as { steps: unknown[]; finished: boolean }
    assert.equal(res.status, 200)
    assert.ok(estado.steps.length >= 6)
    assert.equal(estado.finished, true)
  })

  test('quem reconecta recebe os passos, NÃO o histórico de frames', async () => {
    const recebidos = await ouvir(auditId, 1200)
    const estado = recebidos.find((e) => e['type'] === 'state')
    assert.ok(estado, 'reconexão precisa começar pelo estado')
    const frames = recebidos.filter((e) => e['type'] === 'frame')
    assert.equal(frames.length, 0, 'frame velho não pode ser reenviado')
  })

  test('auditoria desconhecida devolve 404', async () => {
    const res = await fetch(`${base}/api/audit/audit_nao_existe`)
    assert.equal(res.status, 404)
  })

  test('POST sem url é recusado', async () => {
    const pedido = await pedirAuditoria('')
    assert.equal(pedido.status, 400)
  })

  /* A API não tem modo padrão, e isso é decisão de produto: um padrão silencioso
     escolheria por quem pede se a auditoria pode ou não mexer no carrinho de uma
     loja de terceiro. Sem declaração, não roda. */
  test('POST sem modo é recusado, e o erro diz quais existem', async () => {
    const pedido = await pedirAuditoria('', { url: 'https://loja.com.br' })
    assert.equal(pedido.status, 400)
    assert.match(String(pedido.body['error']), /consentido/)
    assert.match(String(pedido.body['error']), /leitura/)
  })

  test('POST consentido sem aceite é recusado', async () => {
    const pedido = await pedirAuditoria('', { url: 'https://loja.com.br', modo: 'consentido' })
    assert.equal(pedido.status, 400)
    assert.match(String(pedido.body['error']), /aceite/)
  })

  test('GET / entrega a tela de execução', async () => {
    const res = await fetch(`${base}/`)
    const html = await res.text()
    assert.equal(res.status, 200)
    assert.match(html, /Raio-X do Checkout/)
    assert.match(html, /\/live\?auditId=/, 'a tela precisa saber conectar no canal')
  })

  test('não serve arquivo fora de public/', async () => {
    const res = await fetch(`${base}/nao-existe.html`)
    assert.equal(res.status, 404)
  })

  test('WebSocket sem auditId é encerrado explicando', async () => {
    const eventos = await new Promise<Record<string, unknown>[]>((resolve) => {
      const recebidos: Record<string, unknown>[] = []
      const ws = new WebSocket(`ws://localhost:${PORT}/live`)
      ws.on('message', (raw) => recebidos.push(JSON.parse(String(raw)) as Record<string, unknown>))
      ws.on('close', () => resolve(recebidos))
      setTimeout(() => resolve(recebidos), 3000)
    })
    assert.equal(eventos[0]?.['code'], 'NO_AUDIT_ID')
  })
})
