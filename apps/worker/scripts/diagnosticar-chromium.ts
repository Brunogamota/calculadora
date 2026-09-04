/**
 * Três eliminações seguidas, todas rápidas na Fly, para os mesmos domínios
 * que travam de verdade na cobertura:
 *
 *   1. rede crua (DNS, TCP, TLS)               — rápida
 *   2. User-Agent honesto vs. de navegador      — idênticos, rápidos
 *   3. seguir redirect e ler o corpo inteiro    — rápido
 *
 * Depois de três hipóteses eliminadas em sequência, o protocolo de causa
 * raiz para de propor uma quarta variação do mesmo tema (um GET com mais
 * uma diferença) e passa a pegar evidência de DENTRO do mecanismo que
 * falha de verdade. Toda tentativa até aqui usou o cliente HTTP do Node —
 * nunca o Chromium. E o que sobra, por eliminação, é justamente o que só
 * existe com um navegador de verdade: impressão digital de TLS diferente
 * (Node não parece Chrome no aperto de mão, mesmo mandando o mesmo
 * cabeçalho), challenge em JavaScript que só roda dentro de um motor de
 * renderização, sinais de automação que só aparecem quando há um
 * `navigator.webdriver` para detectar.
 *
 * Este script não é mais uma hipótese isolada — é o PRÓPRIO `launchBrowser`
 * de produção, com escuta em cada requisição que o Chromium faz. Quando
 * `page.goto` travar, ele mostra exatamente quantas requisições saíram,
 * quantas terminaram, e quais ficaram PENDURADAS — isso localiza o travamento
 * dentro da página real, em vez de mais um palpite por fora.
 *
 * Inclui um domínio que teve sucesso na cobertura (tracksmith.com) como
 * controle: se o padrão de requisições dele for visivelmente diferente dos
 * que travam, a diferença conta a história.
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-chromium"
 *
 * Mais lento que os anteriores — usa o Chromium de verdade, timeout de 30s
 * por domínio, os mesmos parâmetros do motor em produção.
 *
 * RESULTADO DA PRIMEIRA RODADA, registrado aqui porque muda a leitura do
 * script: os QUATRO domínios carregaram limpo, em segundos — incluindo três
 * que tinham estourado 30s de verdade na cobertura, no MESMO caminho de
 * código, sem nada mudar no meio. Isso derruba a hipótese de bloqueio
 * determinístico por loja (fingerprint de TLS, challenge de JS): se fosse
 * isso, travaria nesta rodada também, sempre no mesmo domínio.
 *
 * O que sobra é intermitência — falha por CONDIÇÃO, não por loja. E a pista
 * já estava no log da cobertura original, só não tinha sido lida em ordem:
 * os primeiros candidatos saíram limpos, e a partir de ~13 auditorias
 * seguidas o timeout de 30s virou o desfecho dominante pro resto da lista
 * inteira — assinatura de recurso se esgotando ao longo de uma rodada longa
 * (memória, processo de Chromium não fechando direito), não de antibot
 * reconhecendo loja específica. Ver `snapshotDeRecursos` em
 * `medir-cobertura.ts`, escrito para testar exatamente isso na próxima
 * rodada.
 */

import { launchBrowser } from '../src/lib/browser.ts'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'
import type { Request as PWRequest } from 'playwright'

const AMOSTRA = [
  'gymshark.com',
  'everlane.com',
  'brooklinen.com',
  'tracksmith.com', // controle: este ENTROU na cobertura
] as const

const TIMEOUT_MS = 30_000

interface Rastro {
  url: string
  resourceType: string
  emMs: number
  terminou: boolean
  falhou: string | null
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

async function main(): Promise<void> {
  console.log('')
  console.log('page.goto de verdade, com escuta em cada requisição — timeout de 30s por domínio')
  console.log('')

  const browser = await launchBrowser({ headed: false, userAgent: DEFAULT_USER_AGENT, timeoutMs: 30_000 })
  let algumTravou = false

  try {
    for (const host of AMOSTRA) {
      console.log(`  ── ${host} ──`)
      const context = await browser.browser.newContext({
        userAgent: DEFAULT_USER_AGENT,
        viewport: { width: 1440, height: 900 },
        locale: 'pt-BR',
        timezoneId: 'America/Sao_Paulo',
      })
      const page = await context.newPage()
      const t0 = Date.now()
      const rastro = new Map<PWRequest, Rastro>()

      page.on('request', (req) => {
        rastro.set(req, { url: req.url(), resourceType: req.resourceType(), emMs: Date.now() - t0, terminou: false, falhou: null })
      })
      page.on('requestfinished', (req) => {
        const r = rastro.get(req)
        if (r) r.terminou = true
      })
      page.on('requestfailed', (req) => {
        const r = rastro.get(req)
        if (r) {
          r.terminou = true
          r.falhou = req.failure()?.errorText ?? 'falhou'
        }
      })

      let resultado: 'carregou' | 'travou' | 'erro' = 'erro'
      let detalheErro = ''
      try {
        await page.goto(`https://${host}/`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT_MS })
        resultado = 'carregou'
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        resultado = msg.includes('Timeout') ? 'travou' : 'erro'
        if (resultado === 'travou') algumTravou = true
        detalheErro = msg.split('\n')[0] ?? msg
      }
      const totalMs = Date.now() - t0

      const todas = [...rastro.values()]
      const pendentes = todas.filter((r) => !r.terminou)
      const terminadas = todas.filter((r) => r.terminou && !r.falhou)
      const falhadas = todas.filter((r) => r.falhou)

      linha(`resultado: ${resultado}${detalheErro ? ` (${detalheErro})` : ''} em ${(totalMs / 1000).toFixed(1)}s`)
      linha(`requisições: ${todas.length} total · ${terminadas.length} terminaram · ${falhadas.length} falharam · ${pendentes.length} ainda em voo`)

      /* "Em voo" sozinho não é travamento — domcontentloaded dispara antes de
         imagem, fonte e pixel de analytics terminarem, numa página pesada
         isso é NORMAL. Só vale a pena listar o que ficou pendurado quando o
         `page.goto` de fato travou: aí sim essas linhas são candidatas à
         causa. Rotular isso como "é aqui que travou" mesmo numa carga bem
         sucedida foi o que aconteceu na primeira rodada deste script — os
         quatro domínios carregaram limpo e a lista saiu do mesmo jeito
         alarmante de quando trava, e por pouco não virou diagnóstico errado. */
      if (resultado === 'travou' && pendentes.length > 0) {
        console.log('    penduradas — candidatas à causa do travamento:')
        for (const r of pendentes.slice(0, 8)) {
          linha(`      [${r.resourceType}] ${r.url.slice(0, 90)} (pedida em ${r.emMs}ms)`)
        }
        if (pendentes.length > 8) linha(`      ... e mais ${pendentes.length - 8}`)
      } else if (pendentes.length > 0) {
        linha(`    (${pendentes.length} ainda em voo quando a página terminou de carregar — cauda normal de imagem/fonte/analytics, não é o que travou)`)
      } else if (todas.length > 0) {
        console.log('    última requisição antes do fim:')
        const ultima = todas[todas.length - 1]
        if (ultima) linha(`      [${ultima.resourceType}] ${ultima.url.slice(0, 90)}`)
      }
      console.log('')

      await context.close()
    }
  } finally {
    await browser.close()
  }

  console.log('LEITURA')
  if (!algumTravou) {
    console.log('  NENHUM domínio travou nesta rodada — incluindo os que tinham estourado 30s na')
    console.log('  cobertura, rodando o MESMO caminho de código, sem mudança nenhuma no meio.')
    console.log('  Isso derruba "bloqueio determinístico por loja" (fingerprint de TLS, challenge')
    console.log('  de JS): se fosse isso, travaria de novo, sempre, neste mesmo domínio.')
    console.log('')
    console.log('  O que sobra é INTERMITÊNCIA — falha que depende de uma CONDIÇÃO, não do')
    console.log('  domínio. A pista mais forte já estava no log da cobertura original: os')
    console.log('  primeiros candidatos da lista saíram limpos, e a partir de ~13 auditorias')
    console.log('  seguidas o timeout de 30s virou o desfecho dominante pro resto da lista —')
    console.log('  assinatura clássica de recurso se esgotando ao longo de uma rodada longa e')
    console.log('  sequencial (memória, processo de Chromium não fechando direito), não de')
    console.log('  antibot reconhecendo loja.')
    console.log('')
    console.log('  Próximo passo: `npm run medir-cobertura` de novo, agora com rastro de memória')
    console.log('  e contagem de processos Chromium impresso antes de cada candidato — para ver')
    console.log('  se o recurso realmente cai ao longo da rodada, e em que posição a queda bate')
    console.log('  com o início dos timeouts.')
  } else {
    console.log('  Se as que travaram mostrarem requisição parada em domínio de terceiro')
    console.log('  (analytics, challenge, CDN de proteção) e o controle (tracksmith.com) não')
    console.log('  mostrar nada pendurado, o travamento é uma requisição específica que nunca')
    console.log('  responde — não a página principal.')
    console.log('  Se as que travaram pendurarem na própria home (mesmo domínio, resourceType')
    console.log('  document), o suspeito é fingerprint de TLS do Chromium ou challenge de JS que')
    console.log('  nunca resolve — aí a saída não é mais diagnóstico, é técnica de camuflagem')
    console.log('  (ex.: patchright), e essa é decisão de arquitetura, não correção pontual.')
  }
  console.log('')
}

await main()
