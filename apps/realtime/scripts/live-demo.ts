/**
 * Roda uma auditoria e imprime o que sai pelo WebSocket, evento a evento.
 *
 *   npm run live:demo                    (loja falsa, sem tocar em site nenhum)
 *   npm run live:demo -- loja.com.br
 *
 * É o jeito de ver o canal da §7.4 funcionando antes de existir tela: os passos
 * aparecendo em ordem, os achados durante a execução, e a contagem de frames
 * que realmente atravessou o fio.
 */

import { WebSocket } from 'ws'
import { startFakeStore } from '../../worker/test/fixtures/fake-shopify.ts'

const alvo = process.argv.slice(2).find((a) => !a.startsWith('--'))
const PORT = 4123
process.env['PORT'] = String(PORT)

let fake: Awaited<ReturnType<typeof startFakeStore>> | null = null
let url: string
if (alvo) {
  url = alvo
} else {
  process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
  process.env['AUDIT_COOLDOWN_HOURS'] = '0'
  process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
  fake = await startFakeStore()
  url = fake.url
}

await import('../src/server.ts')
await new Promise((r) => setTimeout(r, 400))

const res = await fetch(`http://localhost:${PORT}/api/audit`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url }),
})
const { auditId } = (await res.json()) as { auditId: string }
console.log(`alvo:    ${url}`)
console.log(`auditId: ${auditId}\n`)

const ws = new WebSocket(`ws://localhost:${PORT}/live?auditId=${auditId}`)
let frames = 0
let bytes = 0
const comecou = Date.now()

await new Promise<void>((resolve) => {
  ws.on('message', (raw) => {
    const texto = String(raw)
    const evento = JSON.parse(texto) as Record<string, unknown>

    if (evento['type'] === 'frame') {
      frames++
      bytes += texto.length
      return
    }
    if (evento['type'] === 'state') {
      const state = evento['state'] as { steps: unknown[] }
      console.log(`(reconexão traria ${state.steps.length} passo(s))`)
      return
    }

    const segundos = ((Date.now() - comecou) / 1000).toFixed(1).padStart(5)
    const tipo = String(evento['type']).padEnd(11)
    const id = String(evento['id'] ?? evento['code'] ?? '').padEnd(15)
    const detalhe = evento['detail'] ?? evento['reason'] ?? evento['title'] ?? evento['label'] ?? ''
    const nota = evento['type'] === 'complete' ? `nota ${String(evento['score'])}` : ''
    console.log(`${segundos}s  ${tipo} ${id} ${String(detalhe)}${nota}`)

    if (evento['type'] === 'complete' || evento['type'] === 'aborted') {
      setTimeout(resolve, 200)
    }
  })
  setTimeout(resolve, 90_000)
})

const kb = bytes / 1024
console.log(`\nframes pelo WebSocket: ${frames}  (${kb.toFixed(0)} KB)`)
ws.close()
await fake?.close()
process.exit(0)
