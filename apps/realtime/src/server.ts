/**
 * §7.4 — canal de tempo real.
 *
 * O worker publica, este servidor assina e repassa para a sala do `auditId`.
 * Na Fase 2 os dois vivem no mesmo processo, com o barramento em memória; a
 * §3 prevê Redis entre eles, e trocar é substituir o Publisher — a interface
 * já é a mesma.
 *
 * Quem reconecta recebe o ESTADO DOS PASSOS, nunca o histórico de frames
 * (§7.4: frame perdido é frame perdido). Sem essa distinção, reconexão viraria
 * uma enxurrada de megabytes de JPEG.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { WebSocketServer, type WebSocket } from 'ws'
import { audit } from '@raio-x/worker/src/audit.ts'
import { MemoryPublisher } from '@raio-x/worker/src/stream/publisher.ts'
import type { AuditEvent } from '@raio-x/types'

const PORT = Number(process.env['PORT'] ?? 4000)
const bus = new MemoryPublisher()

/** Auditorias em andamento, para não rodar a mesma duas vezes. */
const running = new Set<string>()

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': '*',
  })
  res.end(payload)
}

async function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    // Corpo de pedido de auditoria é uma URL. Nada aqui justifica 64 KB.
    if (size > 64 * 1024) throw new Error('corpo grande demais')
    chunks.push(chunk as Buffer)
  }
  if (chunks.length === 0) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function newAuditId(): string {
  return `audit_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'access-control-allow-origin': '*',
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    })
    return res.end()
  }

  // §12: POST /api/audit { url } -> { auditId }
  if (req.method === 'POST' && url.pathname === '/api/audit') {
    void (async () => {
      const body: Record<string, unknown> = await readBody(req).catch(() => ({}))
      const target = typeof body['url'] === 'string' ? body['url'] : ''
      if (!target) return json(res, 400, { error: 'informe { "url": "..." }' })

      /* O modo é obrigatório na entrada, e a API recusa antes de abrir
         navegador. Sem isto, quem chamasse a API sem declarar nada cairia no
         comportamento mais permissivo por omissão — que é exatamente o que o
         modo existe para impedir. */
      const modo = body['modo']
      if (modo !== 'consentido' && modo !== 'leitura') {
        return json(res, 400, {
          error:
            'informe { "modo": "consentido" } quando o responsável pela loja autorizou, ' +
            'ou { "modo": "leitura" } para loja de terceiro. Não há padrão.',
        })
      }

      const aceiteBruto = body['aceite']
      const aceite =
        aceiteBruto !== null && typeof aceiteBruto === 'object'
          ? (aceiteBruto as { em?: unknown; url?: unknown; texto?: unknown })
          : null
      if (modo === 'consentido' && aceite === null) {
        return json(res, 400, {
          error: 'modo consentido exige { "aceite": { "em", "url", "texto" } } registrado antes da execução',
        })
      }

      const auditId = newAuditId()
      json(res, 202, { auditId })

      // A auditoria roda em background; o acompanhamento é pelo WebSocket.
      running.add(auditId)
      audit(target, {
        modo,
        ...(aceite
          ? {
              aceite: {
                em: typeof aceite.em === 'string' ? aceite.em : new Date().toISOString(),
                url: typeof aceite.url === 'string' ? aceite.url : target,
                texto: typeof aceite.texto === 'string' ? aceite.texto : '',
              },
            }
          : {}),
        publisher: bus,
        auditId,
        headed: process.env['AUDIT_HEADED'] === '1',
        /* O atraso existia para dar tempo de ler quando a tela nao tinha
           imagem. Agora o cursor da o ritmo e o screencast mostra o que esta
           acontecendo, entao ele so tira 5,6s da auditoria sem entregar nada.
           Continua ajustavel por variavel para quem quiser desacelerar. */
        stepDelayMs: Number(process.env['AUDIT_STEP_DELAY_MS'] ?? 0),
        fromBrazil: process.env['AUDIT_FROM_BR'] === '1',
      })
        .catch(() => undefined)
        .finally(() => running.delete(auditId))
    })()
    return
  }

  // §12: GET /api/audit/:id — estado atual, para quem não quer WebSocket
  if (req.method === 'GET' && url.pathname.startsWith('/api/audit/')) {
    const auditId = url.pathname.slice('/api/audit/'.length)
    const state = bus.stateOf(auditId)
    if (!state) return json(res, 404, { error: 'auditoria desconhecida' })
    return json(res, 200, { ...state, running: running.has(auditId) })
  }

  if (url.pathname === '/health') return json(res, 200, { ok: true, running: running.size })

  // A tela de execução (bloco 9) é servida daqui quando existir.
  void serveStatic(url.pathname, res)
})

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
  const file = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '')
  // Nada de subir diretório: o servidor só entrega o que está em public/.
  const safe = path.normalize(file).replace(/^(\.\.[/\\])+/, '')
  const full = path.join(process.cwd(), 'apps/realtime/public', safe)
  try {
    const content = await readFile(full)
    const type = safe.endsWith('.html') ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8'
    res.writeHead(200, { 'content-type': type })
    res.end(content)
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
    res.end('não encontrado')
  }
}

const wss = new WebSocketServer({ server, path: '/live' })

wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
  const url = new URL(req.url ?? '/live', `http://localhost:${PORT}`)
  const auditId = url.searchParams.get('auditId') ?? ''

  if (!auditId) {
    socket.send(JSON.stringify({ type: 'aborted', auditId: '', code: 'NO_AUDIT_ID', reason: 'informe ?auditId=' }))
    return socket.close()
  }

  // Estado primeiro: quem reconecta vê os passos que já aconteceram (§7.4).
  const state = bus.stateOf(auditId)
  if (state) socket.send(JSON.stringify({ type: 'state', state }))

  const unsubscribe = bus.subscribe(auditId, (event: AuditEvent) => {
    if (socket.readyState !== socket.OPEN) return
    // Frame acumulado no buffer é frame velho: melhor descartar do que atrasar
    // a transmissão inteira para entregar uma tela que já passou.
    if (event.type === 'frame' && socket.bufferedAmount > 512 * 1024) return
    socket.send(JSON.stringify(event))
  })

  socket.on('close', unsubscribe)
  socket.on('error', unsubscribe)
})

server.listen(PORT, () => {
  // Silencioso quando importado por teste: o ruído esconde o que importa.
  if (process.env['RAIO_X_QUIET'] === '1') return
  console.log(`realtime em http://localhost:${PORT}`)
  console.log(`  POST /api/audit      { "url", "modo", "aceite"? } -> { auditId }`)
  console.log(`  GET  /api/audit/:id  estado atual`)
  console.log(`  WS   /live?auditId=  transmissão`)
})

export { server, wss, bus }

/**
 * Encerra tudo. Sem isto, um `import` deste arquivo num teste deixa o processo
 * vivo para sempre — o servidor segura o event loop e a suíte nunca termina.
 */
export async function closeServer(): Promise<void> {
  for (const socket of wss.clients) socket.terminate()
  await new Promise<void>((resolve) => wss.close(() => resolve()))
  await new Promise<void>((resolve) => server.close(() => resolve()))
}
