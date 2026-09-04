/**
 * `diagnosticar-rede` eliminou a rede: DNS, TCP e TLS crus saíram rápidos na
 * própria máquina da Fly, para os mesmos domínios que travaram na cobertura.
 * Isso não fecha a investigação, sobe ela um andar — Kepner-Tregoe pede
 * explicar o É e o NÃO É ao mesmo tempo, e "a conexão abre rápido, mas a
 * página nunca chega" aponta para a troca HTTP em si, não para chegar até
 * lá.
 *
 * E hipótese: o motor se identifica com um User-Agent HONESTO —
 *
 *   RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)
 *
 * — aplicado no CONTEXTO do Chromium (`browser.ts`, `newContext`), não só num
 * fetch solto. Isso significa que toda navegação real sai com a impressão
 * digital de TLS de um Chromium de verdade (é um Chromium de verdade) e o
 * cabeçalho HTTP dizendo "não sou um navegador, sou um robô". Esse
 * descompasso é exatamente o que sistemas de proteção antibot sofisticados
 * (Cloudflare, Akamai, PerimeterX/HUMAN, proteção própria do Shopify) usam
 * para detectar automação — e uma resposta comum não é recusar rápido, é
 * SEGURAR a conexão (tarpit), que é indistinguível de "a rede caiu" do lado
 * de quem está esperando.
 *
 * Este script testa isso com UMA variável só, do jeito certo (Zeller):
 * o MESMO pedido HTTP, para o MESMO domínio, mudando SÓ o User-Agent — o
 * nosso, honesto, contra um de navegador comum. Se o honesto trava e o outro
 * responde rápido, a causa está confirmada, e a decisão que sobra não é mais
 * técnica: o código documenta a identificação honesta como escolha de
 * princípio ("identificar-se nunca foi sobre permissão, é sobre não parecer
 * o que não é") — trocar isso é decisão do Bruno, não algo para eu decidir
 * sozinho e corrigir calado.
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-user-agent"
 *
 * GET na home, sem cookie, sem repetir — mesma ordem de grandeza de toque
 * que o `detect` já deu nesses domínios minutos atrás.
 */

import https from 'node:https'
import { DEFAULT_USER_AGENT } from '../src/lib/http.ts'

const UA_NAVEGADOR =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

/** Mesma amostra do `diagnosticar-rede`, pra comparar maçã com maçã. */
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

const TIMEOUT_MS = 20_000

interface Resposta {
  status: number | null
  ms: number
  erro: string | null
}

function pedir(host: string, userAgent: string): Promise<Resposta> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const req = https.request(
      {
        host,
        path: '/',
        method: 'GET',
        timeout: TIMEOUT_MS,
        headers: {
          'user-agent': userAgent,
          accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
          'accept-language': 'pt-BR,pt;q=0.9',
        },
      },
      (res) => {
        // Cabeçalho de resposta já chegou — é o que importa medir aqui, não
        // o corpo inteiro. `destroy` evita baixar a página toda à toa.
        res.destroy()
        resolve({ status: res.statusCode ?? null, ms: Date.now() - t0, erro: null })
      },
    )
    req.once('error', (e) => resolve({ status: null, ms: Date.now() - t0, erro: e.message }))
    req.once('timeout', () => {
      req.destroy()
      resolve({ status: null, ms: Date.now() - t0, erro: `travou (>${TIMEOUT_MS}ms)` })
    })
    req.end()
  })
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

function fmt(r: Resposta): string {
  if (r.erro) return r.erro
  return `${r.status} em ${r.ms}ms`
}

async function main(): Promise<void> {
  console.log('')
  console.log('mesmo GET, mesmo domínio — só o User-Agent muda')
  console.log(`  honesto: ${DEFAULT_USER_AGENT}`)
  console.log(`  navegador: ${UA_NAVEGADOR}`)
  console.log('')

  let confirmacoes = 0
  let testados = 0

  for (const host of AMOSTRA) {
    const honesto = await pedir(host, DEFAULT_USER_AGENT)
    const navegador = await pedir(host, UA_NAVEGADOR)
    linha(host.padEnd(24), `honesto: ${fmt(honesto).padEnd(20)}`, `navegador: ${fmt(navegador)}`)

    testados++
    const honestoTravouOuLento = honesto.erro !== null || honesto.ms > 8000
    const navegadorRapido = navegador.erro === null && navegador.ms < 5000
    if (honestoTravouOuLento && navegadorRapido) confirmacoes++
  }

  console.log('')
  console.log('VEREDITO')
  if (confirmacoes >= testados * 0.5) {
    console.log(`  CONFIRMADO em ${confirmacoes} de ${testados}: o mesmo domínio que trava com o`)
    console.log('  User-Agent honesto responde rápido com um de navegador comum. Não é a rede —')
    console.log('  é proteção antibot reagindo à identificação, provavelmente segurando a conexão')
    console.log('  em vez de recusar rápido.')
    console.log('')
    console.log('  A partir daqui a decisão não é técnica: o código declara a identificação')
    console.log('  honesta como princípio, não como detalhe de implementação. Trocar o')
    console.log('  User-Agent aumentaria quanta loja o motor consegue auditar, ao custo de deixar')
    console.log('  de se anunciar como o que é. Essa troca é do Bruno, não minha.')
  } else if (confirmacoes > 0) {
    console.log(`  PARCIAL: ${confirmacoes} de ${testados} confirmam o padrão, não todos.`)
    console.log('  Existe alguma coisa aqui, mas não é a explicação única — pode haver mais de')
    console.log('  uma causa entre os que travaram na cobertura.')
  } else {
    console.log('  NÃO CONFIRMADO nesta amostra. O User-Agent não é a explicação — a suspeita')
    console.log('  volta para outra camada (talvez o próprio Playwright/Chromium fazendo algo')
    console.log('  diferente de um GET puro, como carregar recursos da página que travam).')
  }
  console.log('')
}

await main()
