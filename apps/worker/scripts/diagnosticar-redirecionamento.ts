/**
 * Rede eliminada. User-Agent eliminado — testado na Fly, os dois (honesto e
 * de navegador) saíram rápidos e IDÊNTICOS, sem travamento em nenhum dos
 * dois. Hipótese rejeitada, e isso é ganho: o espaço de busca encolheu.
 *
 * Mas metade da amostra respondeu 301/302 naquele teste — e ele só olhou a
 * PRIMEIRA resposta, nunca seguiu o redirect nem leu o corpo. O `page.goto`
 * do Chromium (`browser.ts`, `waitUntil: 'domcontentloaded'`) segue a cadeia
 * de redirect inteira e espera o HTML final ser recebido e parseado. É uma
 * camada que nenhum dos dois testes anteriores tocou — a diferença entre
 * "a primeira resposta chega rápido" e "a página inteira termina de
 * carregar" é exatamente onde os 30s podem estar escondidos.
 *
 * Esta hipótese também bate com algo que o próprio código já previa: marca
 * global vendo IP de datacenter brasileiro pode cair em modal de
 * redirecionamento de região, ou challenge geo-específico — é o que
 * `environment.ts`/`vantageContradiction` documenta sobre auditar do Brasil.
 *
 * Este script segue o redirect (até 5 saltos) e lê o corpo até o fim (ou até
 * travar), com timeout de 28s — perto do limite real do Chromium — medindo
 * CADA salto separado: se o travamento mora no primeiro GET, num salto do
 * meio, ou em terminar de baixar a página final.
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-redirecionamento"
 */

import https from 'node:https'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'

const AMOSTRA = [
  'gymshark.com',
  'everlane.com',
  'rothys.com',
  'brooklinen.com',
  'alo.com',
  'fearofgod.com',
  'ironstudios.com.br',
  'ekomat.com.br',
  'coffeemais.com',
  'amaro.com',
] as const

const TIMEOUT_MS = 28_000
const MAX_SALTOS = 5

interface Salto {
  url: string
  status: number | null
  headersMs: number | null
  corpoMs: number | null
  bytes: number
  erro: string | null
}

function requisitar(url: string): Promise<Salto> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    let headersMs: number | null = null
    let status: number | null = null
    let bytes = 0

    const finalizar = (erro: string | null): void => {
      resolve({ url, status, headersMs, corpoMs: erro ? null : Date.now() - t0, bytes, erro })
    }

    let req: ReturnType<typeof https.request>
    try {
      req = https.request(
        url,
        {
          method: 'GET',
          timeout: TIMEOUT_MS,
          headers: {
            'user-agent': DEFAULT_USER_AGENT,
            accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
            'accept-language': 'pt-BR,pt;q=0.9',
          },
        },
        (res) => {
          status = res.statusCode ?? null
          headersMs = Date.now() - t0
          res.on('data', (chunk: Buffer) => {
            bytes += chunk.length
          })
          res.on('end', () => finalizar(null))
          res.on('error', (e) => finalizar(`corpo: ${e.message}`))
        },
      )
    } catch (e) {
      finalizar(`url inválida: ${e instanceof Error ? e.message : String(e)}`)
      return
    }
    req.once('error', (e) => finalizar(`req: ${e.message}`))
    req.once('timeout', () => {
      req.destroy()
      finalizar(`travou (>${TIMEOUT_MS}ms)`)
    })
    req.end()
  })
}

/** Segue redirect manualmente, salto a salto, medindo cada um. */
async function seguirCadeia(hostInicial: string): Promise<Salto[]> {
  const saltos: Salto[] = []
  let urlAtual = `https://${hostInicial}/`

  for (let i = 0; i < MAX_SALTOS; i++) {
    const salto = await requisitar(urlAtual)
    saltos.push(salto)
    if (salto.erro || salto.status === null) break
    if (salto.status < 300 || salto.status >= 400) break // não é redirect, cadeia terminou

    // Onde foi o redirect? Precisa ler o header Location — o `requisitar`
    // acima não devolve isso, então refaz a chamada só pra pegar o destino.
    const destino = await new Promise<string | null>((resolve) => {
      const req = https.request(
        urlAtual,
        { method: 'HEAD', timeout: 8000, headers: { 'user-agent': DEFAULT_USER_AGENT } },
        (res) => resolve(res.headers.location ?? null),
      )
      req.once('error', () => resolve(null))
      req.once('timeout', () => {
        req.destroy()
        resolve(null)
      })
      req.end()
    })
    if (!destino) break
    urlAtual = new URL(destino, urlAtual).href
  }
  return saltos
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

async function main(): Promise<void> {
  console.log('')
  console.log('seguindo o redirect até o fim, lendo o corpo inteiro — timeout de 28s por salto')
  console.log('')

  let travouEmAlgumSalto = 0
  let terminouLimpo = 0

  for (const host of AMOSTRA) {
    console.log(`  ${host}`)
    const saltos = await seguirCadeia(host)
    let travou = false
    for (const [i, s] of saltos.entries()) {
      const cabecalho = s.headersMs !== null ? `cabeçalho ${s.headersMs}ms` : 'sem cabeçalho'
      const corpo = s.erro
        ? `ERRO: ${s.erro}`
        : s.corpoMs !== null
          ? `corpo completo em ${s.corpoMs}ms (${s.bytes} bytes)`
          : '?'
      linha(`    salto ${i + 1}: ${s.status ?? '?'} · ${s.url.slice(0, 60)}`, cabecalho, corpo)
      if (s.erro?.includes('travou')) travou = true
    }
    if (travou) travouEmAlgumSalto++
    else terminouLimpo++
  }

  console.log('')
  console.log('VEREDITO')
  console.log(`  travou em algum salto: ${travouEmAlgumSalto} de ${AMOSTRA.length}`)
  console.log(`  terminou limpo: ${terminouLimpo} de ${AMOSTRA.length}`)
  console.log('')
  if (travouEmAlgumSalto > 0) {
    console.log('  CONFIRMADO: o travamento existe fora da rede crua e fora do primeiro GET —')
    console.log('  está em seguir o redirect ou em terminar de baixar a página. Olhe qual URL')
    console.log('  aparece como o salto que travou, acima: se for sempre o mesmo padrão (ex.:')
    console.log('  redirecionando pra um domínio de país/idioma), é modal de geo-redirecionamento')
    console.log('  ou challenge que só aparece no destino, não na primeira resposta.')
  } else {
    console.log('  NÃO CONFIRMADO: mesmo seguindo redirect e lendo o corpo inteiro, tudo terminou')
    console.log('  rápido aqui. A causa do travamento na cobertura ainda não foi isolada — resta')
    console.log('  o Chromium em si (execução de JS de challenge, recursos da página, algo que só')
    console.log('  acontece com um navegador de verdade renderizando, não com um GET puro).')
  }
  console.log('')
}

await main()
