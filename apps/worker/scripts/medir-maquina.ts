/**
 * A máquina é o gargalo, ou não é?
 *
 *   npm run medir
 *
 * Em produção a sallve estourou o prazo com `identificando a loja: 66,9s`, e o
 * log da captura na Fly saiu assim:
 *
 *   [raio-x] captura: 122 publicados de 144 recebidos em 129.7s (0.9 fps)
 *
 * contra ~2,4 fps aqui no ambiente de desenvolvimento. Duas explicações
 * diferentes cabem no mesmo número: ou a máquina da Fly é lenta demais para o
 * trabalho, ou as lojas reais é que são pesadas e a máquina está bem. Enquanto
 * as duas estiverem de pé, medir taxa de acerto em loja de verdade não decide
 * nada — uma máquina faminta faria TODA loja estourar o prazo, e o número da
 * cobertura sairia envenenado.
 *
 * O experimento que separa as duas: rodar o MESMO trabalho, contra a MESMA
 * loja falsa, aqui e lá dentro do contêiner. Mesmo código, mesma imagem, mesma
 * página — só a máquina muda. O que sobrar de diferença é da máquina.
 *
 * Loja falsa também porque ela não tem anti-bot, não tem intervalo entre
 * auditorias, não é de ninguém, e responde igual toda vez. Nada aqui toca site
 * de terceiro (§2.2).
 *
 * Lá dentro:
 *
 *   fly ssh console -a raio-x-motor -C "npm run medir"
 *
 * PREVISÃO, escrita antes de rodar: se a prova de CPU pura na Fly for
 * duas vezes ou mais lenta que a referência, a máquina é o defeito, e a
 * correção é uma linha no fly.toml (`size`). Se a CPU pura sair parecida e só
 * a auditoria sair lenta, a máquina está bem e o problema é outro — aí a
 * investigação muda de lugar, não de tamanho.
 */

import os from 'node:os'
import { audit } from '../src/audit.ts'
import { launchBrowser } from '../src/lib/browser.ts'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'
import { startFakeStore } from '../test/fixtures/fake-shopify.ts'
import type { Publisher } from '../src/stream/publisher.ts'
import type { AuditEvent, LiveState } from '@raio-x/types'

/* A loja falsa mora em 127.0.0.1, e o guarda de SSRF (§2.5) recusa alvo local
   por padrão — corretamente. Aqui o alvo local é o ponto do experimento. */
process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

/**
 * A referência, medida no contêiner de desenvolvimento deste projeto com este
 * mesmo script.
 *
 * Não é a máquina do Bruno e não finge ser: é o ambiente onde os 2,4 fps que
 * levantaram a suspeita foram medidos, então é contra ele que a comparação faz
 * sentido. Refazer a referência é rodar este script aqui de novo.
 */
const REFERENCIA = {
  onde: '4 núcleos Xeon 2.10GHz, 15.7 GB',
  /* Três execuções seguidas, e a variação entre elas foi menor que 2% em
     todas as linhas — 3405/3425/3455 na CPU, 2.2/2.3/2.2 fps. Número que
     balança não serve de referência, então isto foi conferido antes de ser
     gravado, não depois. */
  cpuMs: 3425,
  navegadorMs: 87,
  identifyMs: 2510,
  auditoriaMs: 10_200,
  fps: 2.2,
}

/** Marca o tempo de algo, sem ficar repetindo Date.now() por toda parte. */
async function cronometrar<T>(f: () => Promise<T>): Promise<[T, number]> {
  const t0 = Date.now()
  const valor = await f()
  return [valor, Date.now() - t0]
}

/**
 * Aritmética pura, sem disco, sem rede, sem navegador.
 *
 * É a única prova aqui que mede a MÁQUINA e nada mais. Auditoria mistura CPU,
 * rede local, disco e Chromium; se só ela ficasse lenta, não daria para saber
 * qual dos quatro. Esta isola o primeiro.
 *
 * O corpo é besteira de propósito — o que importa é ser sempre a mesma
 * besteira, na mesma quantidade. `Math.sin` e a raiz impedem o motor de
 * JavaScript de perceber que o resultado é descartável e apagar o laço.
 */
function provaDeCpu(): number {
  let acc = 0
  for (let i = 1; i <= 40_000_000; i++) {
    acc += Math.sqrt(i) * Math.sin(i)
  }
  return acc
}

/** Três medições, e fica a melhor: ruído só atrapalha para cima. */
function melhorDeTres(f: () => unknown): number {
  let melhor = Number.POSITIVE_INFINITY
  for (let i = 0; i < 3; i++) {
    const t0 = Date.now()
    f()
    melhor = Math.min(melhor, Date.now() - t0)
  }
  return melhor
}

/** Só conta o que passou. O motor não sabe que está sendo medido. */
class PublisherQueConta implements Publisher {
  frames = 0
  bytes = 0
  primeiroFrameEm: number | null = null
  ultimoFrameEm: number | null = null
  readonly #inicio = Date.now()

  publish(_auditId: string, event: AuditEvent): void {
    if (event.type !== 'frame') return
    this.frames++
    this.bytes += event.data.length
    const agora = Date.now() - this.#inicio
    if (this.primeiroFrameEm === null) this.primeiroFrameEm = agora
    this.ultimoFrameEm = agora
  }
  subscribe(_auditId: string, _listener: (event: AuditEvent) => void): () => void {
    return () => {}
  }
  stateOf(_auditId: string): LiveState | null {
    return null
  }
}

function linha(rotulo: string, aqui: string, referencia: string, veredito = ''): void {
  console.log(`  ${rotulo.padEnd(26)} ${aqui.padStart(11)}   ${referencia.padStart(11)}   ${veredito}`)
}

/** Quantas vezes mais lento (>1) ou mais rápido (<1) que a referência. */
function razao(aqui: number, ref: number): string {
  // Zero de qualquer lado é medida ausente, não medida rápida.
  if (ref <= 0 || aqui <= 0) return '—'
  const r = aqui / ref
  if (r >= 1) return `${r.toFixed(1)}× mais lento`
  return `${(1 / r).toFixed(1)}× mais rápido`
}

async function main(): Promise<void> {
  const cpus = os.cpus()
  console.log('')
  console.log('  MÁQUINA')
  console.log(`  ${cpus.length} núcleo(s) · ${cpus[0]?.model ?? 'modelo desconhecido'}`)
  console.log(`  ${(os.totalmem() / 1024 ** 3).toFixed(2)} GB de memória · carga ${os.loadavg().map((n) => n.toFixed(2)).join(' ')}`)
  console.log('')

  process.stdout.write('  medindo CPU pura... ')
  const cpuMs = melhorDeTres(provaDeCpu)
  console.log(`${cpuMs} ms`)

  /* Duas vezes, e vale a segunda. A primeira carrega o binário do disco e
     mediria o cache do sistema de arquivos junto; em produção a máquina fica
     de pé e sobe um navegador por auditoria, que é a segunda. */
  process.stdout.write('  subindo o Chromium... ')
  const [frio, frioMs] = await cronometrar(() =>
    launchBrowser({ headed: false, userAgent: DEFAULT_USER_AGENT, timeoutMs: 60_000 }),
  )
  await frio.close()
  const [quente, navegadorMs] = await cronometrar(() =>
    launchBrowser({ headed: false, userAgent: DEFAULT_USER_AGENT, timeoutMs: 60_000 }),
  )
  await quente.close()
  console.log(`${navegadorMs} ms (primeira, fria: ${frioMs} ms)`)

  process.stdout.write('  auditando a loja falsa... ')
  /* A mesma espera da fixture usada no teste de captura: a home entrega o
     visível na hora e só fecha depois. Nenhuma loja real manda a página
     inteira num pacote só, e é essa janela que a captura precisa aguentar. */
  const loja = await startFakeStore({ homeStreamDelayMs: 1200, overlay: 'consent' })
  const contador = new PublisherQueConta()
  let resultado
  let auditoriaMs = 0
  try {
    ;[resultado, auditoriaMs] = await cronometrar(() =>
      audit(loja.url, {
        /* Consentido, e o aceite é honesto: a loja é esta, subiu neste
           processo, e some quando ele acaba. É o modo que roda a jornada
           INTEIRA — em leitura ela para antes do carrinho, e a janela de
           captura fica curta demais para uma taxa de frames significar algo. */
        modo: 'consentido',
        aceite: { em: new Date().toISOString(), url: loja.url, texto: 'loja falsa deste script' },
        headed: false,
        publisher: contador,
        screencast: true,
        outDir: '/tmp/raio-x-medicao',
      }),
    )
  } finally {
    await loja.close()
  }
  console.log(`${(auditoriaMs / 1000).toFixed(1)} s`)

  /* `open-home` é o passo da jornada; na tela ao vivo ele aparece com o rótulo
     "identificando a loja", que é o que estourou 66,9s na sallve. Vocabulários
     diferentes para a mesma etapa — procurar por 'identify' aqui devolvia
     `undefined`, e a linha saía 0 ms fingindo medida. */
  const identify = resultado.steps.find((s) => s.id === 'open-home')
  const identifyMs = identify?.ms ?? 0
  const janelaDeFrames =
    contador.primeiroFrameEm !== null && contador.ultimoFrameEm !== null
      ? contador.ultimoFrameEm - contador.primeiroFrameEm
      : 0
  const fps = janelaDeFrames > 0 ? (contador.frames / (janelaDeFrames / 1000)) : 0

  console.log('')
  console.log(`  referência: ${REFERENCIA.onde}`)
  console.log('')
  console.log('  MEDIDA                            aqui    referência   veredito')
  console.log('  ' + '─'.repeat(72))
  linha('CPU pura', `${cpuMs} ms`, `${REFERENCIA.cpuMs} ms`, razao(cpuMs, REFERENCIA.cpuMs))
  linha('subir o Chromium', `${navegadorMs} ms`, `${REFERENCIA.navegadorMs} ms`, razao(navegadorMs, REFERENCIA.navegadorMs))
  linha('identificar a loja', `${identifyMs} ms`, `${REFERENCIA.identifyMs} ms`, razao(identifyMs, REFERENCIA.identifyMs))
  linha('auditoria inteira', `${(auditoriaMs / 1000).toFixed(1)} s`, `${(REFERENCIA.auditoriaMs / 1000).toFixed(1)} s`, razao(auditoriaMs, REFERENCIA.auditoriaMs))
  linha(
    'frames publicados',
    `${fps.toFixed(1)} fps`,
    `${REFERENCIA.fps.toFixed(1)} fps`,
    REFERENCIA.fps > 0 ? razao(REFERENCIA.fps, fps) : '—',
  )
  console.log('')
  console.log('  ONDE O TEMPO FOI')
  for (const passo of resultado.steps) {
    console.log(`  ${passo.id.padEnd(26)} ${String(passo.ms).padStart(7)} ms   ${passo.outcome.status}`)
  }
  console.log('')
  console.log(`  ${contador.frames} frames em ${(janelaDeFrames / 1000).toFixed(1)}s · ${Math.round(contador.bytes / 1024)} KB`)
  console.log(`  desfecho da auditoria: ${resultado.status}${resultado.errorCode ? ` (${resultado.errorCode})` : ''}`)
  console.log('')

  /* O veredito sai escrito, e sai daqui, porque a previsão foi declarada antes
     de rodar. Deixar a conclusão para a leitura do olho é como três correções
     seguidas viram três narrativas diferentes sobre o mesmo número. */
  if (REFERENCIA.cpuMs <= 0) {
    console.log('  Sem referência gravada ainda: estes são os números que viram a referência.')
  } else if (cpuMs >= REFERENCIA.cpuMs * 2) {
    console.log('  VEREDITO: a máquina é o gargalo. A CPU pura, que não depende de rede nem de')
    console.log('  loja nenhuma, é pelo menos duas vezes mais lenta que a referência. Medir')
    console.log('  taxa de acerto em loja real antes de trocar o `size` no fly.toml mede a')
    console.log('  máquina, não as lojas.')
  } else {
    console.log('  VEREDITO: a máquina NÃO é o gargalo. A CPU pura está no mesmo patamar da')
    console.log('  referência, então a lentidão em produção vem das lojas reais — rede, peso')
    console.log('  da página, anti-bot — e não do tamanho da máquina. A investigação muda de')
    console.log('  lugar: trocar o `size` não resolveria.')
  }
  console.log('')
}

await main()
