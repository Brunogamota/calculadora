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
import { createDeps } from '@raio-x/worker/src/preflight.ts'
import { verificarTitularidade, segredoDoAmbiente, META_NAME } from '@raio-x/worker/src/lib/titularidade.ts'
import { toAuditError } from '@raio-x/worker/src/lib/errors.ts'
import { criarPortaria, ipDoPedido, maxSimultaneas } from './portaria.ts'
import { aquecerNavegador, deveAquecer } from './aquecimento.ts'
import { MemoryPublisher } from '@raio-x/worker/src/stream/publisher.ts'
import type { AuditEvent } from '@raio-x/types'

const PORT = Number(process.env['PORT'] ?? 4000)
const bus = new MemoryPublisher()
const portaria = criarPortaria()

/**
 * De onde o site pode falar com o motor.
 *
 * Era `*` — qualquer página da internet podia disparar auditorias no nosso
 * servidor a partir do navegador de quem a abrisse. Enquanto isto rodava em
 * localhost não custava nada; publicado, custa.
 *
 * Vazio libera geral, e é o que mantém o desenvolvimento e os roteiros de
 * verificação funcionando sem configurar nada. Em produção, `RAIO_X_ORIGENS`
 * traz os domínios do site, separados por vírgula.
 */
const ORIGENS = (process.env['RAIO_X_ORIGENS'] ?? '')
  .split(',')
  .map((o) => o.trim())
  .filter((o) => o.length > 0)

function origemPermitida(origem: string | undefined): string {
  if (ORIGENS.length === 0) return '*'
  if (origem && ORIGENS.includes(origem)) return origem
  // Origem desconhecida não recebe permissão: o navegador dela barra a resposta.
  return ORIGENS[0] as string
}

/** Auditorias em andamento, para não rodar a mesma duas vezes. */
const running = new Set<string>()

function json(res: ServerResponse, status: number, body: unknown, origem?: string): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': origemPermitida(origem),
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
      'access-control-allow-origin': origemPermitida(req.headers.origin),
      'access-control-allow-headers': 'content-type',
      'access-control-allow-methods': 'GET,POST,OPTIONS',
    })
    return res.end()
  }

  /* POST /api/verificar { url } -> { hostname, metaName, token, verificado, motivo? }
  
     O que a tela precisa para ensinar o lojista a liberar a jornada completa:
     a linha que ele tem que colar, e se ela já está no ar.
  
     Devolve o token para QUALQUER domínio pedido, e isso é deliberado — é o
     mesmo modelo do Search Console. A segurança não está em esconder o token,
     está em não conseguir publicá-lo no site de outra pessoa: `lerEtiqueta`
     só olha dentro do <head>, onde conteúdo de visitante não entra.
  
     Passa pela portaria como qualquer pedido: são duas requisições de saída
     (robots e home) contra um domínio que o chamador escolhe, e sem limite
     isto viraria um proxy de varredura com o nosso IP na conta. */
  if (req.method === 'POST' && url.pathname === '/api/verificar') {
    void (async () => {
      const origem = req.headers.origin
      const ip = ipDoPedido(req.headers)
      const naoEntra = portaria.recusa(ip, running.size)
      if (naoEntra) return json(res, 429, { error: naoEntra }, origem)

      const body: Record<string, unknown> = await readBody(req).catch(() => ({}))
      const target = typeof body['url'] === 'string' ? body['url'] : ''
      if (!target) return json(res, 400, { error: 'informe { "url": "..." }' }, origem)

      portaria.registra(ip)
      try {
        const deps = createDeps()
        const r = await verificarTitularidade(target, deps.safeFetch, segredoDoAmbiente())
        return json(
          res,
          200,
          r.verificado
            ? { hostname: r.hostname, metaName: META_NAME, token: r.token, verificado: true }
            : {
                hostname: r.hostname,
                metaName: META_NAME,
                token: r.token,
                verificado: false,
                motivo: r.motivo,
                detalhe: r.detalhe,
              },
          origem,
        )
      } catch (e) {
        const err = toAuditError(e)
        /* CONFIG_INVALIDA é falha NOSSA de configuração, não pedido inválido
           de quem chamou: 500, para não ensinar o lojista a procurar erro no
           que ele digitou. */
        const status = err.code === 'CONFIG_INVALIDA' ? 500 : 400
        return json(res, status, { error: err.message, code: err.code }, origem)
      }
    })()
    return
  }

  // §12: POST /api/audit { url } -> { auditId }
  if (req.method === 'POST' && url.pathname === '/api/audit') {
    void (async () => {
      const origem = req.headers.origin
      /* A portaria vem ANTES de ler o corpo e antes de qualquer navegador: o
         objetivo é justamente não pagar o custo do pedido que vai ser
         recusado. Ver a nota em portaria.ts sobre o que cada limite protege. */
      const ip = ipDoPedido(req.headers)
      const naoEntra = portaria.recusa(ip, running.size)
      if (naoEntra) return json(res, 429, { error: naoEntra }, origem)

      const body: Record<string, unknown> = await readBody(req).catch(() => ({}))
      const target = typeof body['url'] === 'string' ? body['url'] : ''
      if (!target) return json(res, 400, { error: 'informe { "url": "..." }' }, origem)

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
        }, origem)
      }

      const aceiteBruto = body['aceite']
      const aceite =
        aceiteBruto !== null && typeof aceiteBruto === 'object'
          ? (aceiteBruto as { em?: unknown; url?: unknown; texto?: unknown })
          : null
      if (modo === 'consentido' && aceite === null) {
        return json(res, 400, {
          error: 'modo consentido exige { "aceite": { "em", "url", "texto" } } registrado antes da execução',
        }, origem)
      }

      const auditId = newAuditId()
      portaria.registra(ip)
      json(res, 202, { auditId }, origem)

      // A auditoria roda em background; o acompanhamento é pelo WebSocket.
      running.add(auditId)
      audit(target, {
        modo,
        /* O aceite viaja COMO VEIO, sem preenchimento nosso.
        
           Isto aqui completava os campos que faltavam — `em` virava agora,
           `url` virava o alvo, `texto` virava string vazia. O efeito era que
           `{"url":"lojaalheia.com.br","modo":"consentido","aceite":{}}` num
           endpoint público montava um aceite de aparência perfeita para uma
           loja que ninguém tinha autorizado.
        
           Agora o que chega incompleto é recusado pelo próprio `audit()`, com
           a mensagem certa. Servidor que conserta o pedido do cliente esconde
           o erro do cliente — e neste caso escondia que não havia autorização
           nenhuma. */
        ...(aceite
          ? {
              aceite: {
                em: typeof aceite.em === 'string' ? aceite.em : '',
                url: typeof aceite.url === 'string' ? aceite.url : '',
                texto: typeof aceite.texto === 'string' ? aceite.texto : '',
              },
            }
          : {}),
        publisher: bus,
        auditId,
        /* NUNCA no caminho público, e escrito de propósito em vez de omitido.
           `fillCheckout` preenche o checkout com a identidade real do .env —
           nome, CPF, endereço. Num motor aberto a qualquer um, ligar isto
           colocaria os dados pessoais do dono do projeto como um checkout
           abandonado no admin de lojas de estranhos. Estava desligado por
           esquecimento; agora está desligado por decisão. */
        fillCheckout: false,
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

  if (url.pathname === '/health') {
    return json(res, 200, {
      ok: true,
      running: running.size,
      teto: maxSimultaneas(),
      enderecosNaJanela: portaria.tamanho(),
    })
  }

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
  /* O aquecimento roda SOLTO, e depois do listen. Duas coisas de propósito:
     a porta já está aberta quando ele começa, e ele não é esperado.
     
     Se fosse antes, ou se fosse aguardado, a checagem de saúde da Fly bateria
     no /health durante os 16 segundos da subida fria e encontraria a porta
     fechada — o `grace_period` é de 20s. Trocar 16s de primeira auditoria por
     um deploy reprovado seria piorar. */
  if (deveAquecer()) {
    void aquecerNavegador().then((ms) => {
      if (ms === null) return
      console.error(`[raio-x] navegador aquecido em ${(ms / 1000).toFixed(1)}s`)
    })
  }

  // Silencioso quando importado por teste: o ruído esconde o que importa.
  if (process.env['RAIO_X_QUIET'] === '1') return
  console.log(`realtime em http://localhost:${PORT}`)
  console.log(`  POST /api/audit      { "url", "modo", "aceite"? } -> { auditId }`)
  console.log(`  POST /api/verificar  { "url" } -> { token, metaName, verificado }`)
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
