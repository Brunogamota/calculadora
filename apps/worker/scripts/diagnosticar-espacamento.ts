/**
 * Rede, User-Agent, redirect+corpo e recurso local (memória, processo de
 * Chromium) — quatro hipóteses eliminadas com evidência real da Fly. A
 * última caiu de um jeito que aponta pra frente: `livre` ficou estável em
 * ~500-520MB de 962MB disponíveis, `chromium` nunca passou de 1, e o
 * primeiro timeout da segunda rodada de cobertura apareceu já na posição
 * #10 — com a memória ainda em 559MB, praticamente igual ao início. Não deu
 * tempo de faltar recurso nenhum.
 *
 * O que sobra, por eliminação repetida: `gymshark.com`, `everlane.com` e
 * `brooklinen.com` carregaram LIMPO num teste isolado (poucos pedidos, logo
 * depois de um deploy) e TRAVARAM nas duas rodadas de cobertura (227
 * pedidos, para dezenas de domínios diferentes, em ~2 horas seguidas, do
 * mesmo IP). A diferença entre os dois testes não é o domínio nem o recurso
 * local — é VOLUME e RITMO. Isso é a assinatura de reputação de IP por taxa
 * de pedidos, comum em CDN grande (boa parte dessas marcas usa Cloudflare):
 * pontuação que sobe com a velocidade dos pedidos, não só com o destino.
 *
 * Este script pega uma amostra de domínios que travaram na última cobertura
 * — a MESMA hipótese de sempre, aplicada por eliminação, então NÃO é mais
 * uma variação cega — e repete, um de cada vez, com um intervalo deliberado
 * entre eles. Se a mesma loja que travou em rajada passar quando pedida
 * devagar, a causa está confirmada — E isso muda a leitura do risco de
 * lançamento: ninguém vai auditar 227 lojas em rajada. Um usuário real pede
 * a própria loja, uma vez. Se o gatilho é ritmo, o "3 de 227" desta medição
 * pode estar SUBESTIMANDO o que vai acontecer em uso real.
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-espacamento"
 *
 * Demora: ~2,5 minutos de intervalo entre cada domínio, ~12 domínios — uns
 * 30-40 minutos no total. Mais barato que repetir a cobertura inteira, e é a
 * pergunta certa desta vez.
 */

import { medirLeitura } from './medir-cobertura.ts'

/**
 * Amostra da ÚLTIMA cobertura: todos travaram com NETWORK_ERROR (page.goto
 * 30s), misturando BR e internacional, cedo e tarde na lista original —
 * para não confundir "espaçado ajudou" com "esta parte da lista era mais
 * fácil". Inclui os três do teste isolado anterior (gymshark, everlane,
 * brooklinen), para comparar direto com aquele resultado.
 */
const AMOSTRA = [
  'simpleorganic.com.br', // posição #10 na cobertura — o primeiro a travar
  'pantys.com.br', // posição #11
  'steamtoy.com.br',
  'ekomat.com.br',
  'gymshark.com', // travou nas DUAS coberturas, passou isolado
  'everlane.com', // idem
  'brooklinen.com', // idem
  'rothys.com',
  'fearofgod.com',
  'colourpop.com',
  'mous.co',
  'noahny.com', // posição #224 — perto do fim da lista
] as const

const INTERVALO_MS = 150_000 // 2,5 min

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

async function main(): Promise<void> {
  console.log('')
  console.log(`espaçando ${AMOSTRA.length} domínios que travaram na cobertura, ${INTERVALO_MS / 1000}s entre cada um`)
  console.log('')

  let entraram = 0
  let travaramDeNovo = 0
  let outraCoisa = 0

  for (const [indice, hostname] of AMOSTRA.entries()) {
    if (indice > 0) {
      process.stdout.write(`  (esperando ${INTERVALO_MS / 1000}s antes do próximo...) `)
      await pausa(INTERVALO_MS)
      console.log('pronto')
    }
    process.stdout.write(`  #${indice + 1} ${hostname.padEnd(28)} `)
    const { desfecho, ms } = await medirLeitura(`https://${hostname}`)
    const tempo = `${(ms / 1000).toFixed(1)}s`.padStart(6)

    /* "Travou de novo" cobre os dois lugares onde um timeout pode aparecer:
       no `detect` (faixa descartada-no-detect, o caso comum) ou, se o detect
       passar desta vez e for o `audit` de leitura que travar depois, na
       faixa abortou. Checar só um dos dois teria classificado errado um
       resultado que mudou de estágio entre as rodadas. */
    const travouOuEstourou = (t: string): boolean => t.includes('NETWORK_ERROR') || t.includes('DEADLINE_EXCEEDED')
    if (desfecho.faixa === 'entrou') {
      console.log(`${tempo}  ENTROU (não travou mais)   ${desfecho.detalhe}`)
      entraram++
    } else if (
      (desfecho.faixa === 'descartada-no-detect' && travouOuEstourou(desfecho.detalhe)) ||
      (desfecho.faixa === 'abortou' && travouOuEstourou(desfecho.codigo))
    ) {
      const detalhe = desfecho.faixa === 'abortou' ? `${desfecho.codigo}: ${desfecho.detalhe}` : desfecho.detalhe
      console.log(`${tempo}  travou de novo              ${detalhe}`)
      travaramDeNovo++
    } else {
      const detalhe = desfecho.faixa === 'abortou' ? `${desfecho.codigo}: ${desfecho.detalhe}` : desfecho.detalhe
      console.log(`${tempo}  outro desfecho              ${detalhe}`)
      outraCoisa++
    }
  }

  console.log('')
  console.log('VEREDITO')
  linha(`entrou (não travou mais, espaçado): ${entraram} de ${AMOSTRA.length}`)
  linha(`travou de novo mesmo espaçado: ${travaramDeNovo} de ${AMOSTRA.length}`)
  linha(`outro desfecho (mudou de causa): ${outraCoisa} de ${AMOSTRA.length}`)
  console.log('')

  if (entraram >= AMOSTRA.length * 0.4) {
    console.log('  CONFIRMADO: espaçar resolveu a maioria. O travamento é sensível a RITMO, não')
    console.log('  ao domínio nem a recurso local — é reputação de IP por volume de pedidos.')
    console.log('  Isso é boa notícia pro lançamento: uso real (um usuário, uma loja, uma vez)')
    console.log('  não bate nesse gatilho. O "3 de 227" desta cobertura mede a rajada da própria')
    console.log('  medição, não o que vai acontecer em produção. Correção possível: um intervalo')
    console.log('  mínimo entre auditorias vindas de IPs de destino diferentes, ou aceitar que')
    console.log('  cobertura ampla precisa ser medida devagar, ao longo de dias, não numa sessão só.')
  } else if (entraram === 0) {
    console.log('  NÃO CONFIRMADO: nada mudou com o espaçamento. O travamento não é sensível a')
    console.log('  ritmo — volta a ser algo fixo por domínio, e as quatro eliminações anteriores')
    console.log('  (rede, UA, redirect, recurso local) ficam sem explicação alternativa clara.')
    console.log('  Chegou o ponto de questionar a arquitetura em vez de mais uma hipótese isolada')
    console.log('  — ver Fase 6 do protocolo de causa raiz.')
  } else {
    console.log('  PARCIAL: alguns passaram, outros não. Ritmo é PARTE da explicação, não a')
    console.log('  única. Vale olhar se os que continuaram travando têm algo em comum (mesma CDN,')
    console.log('  mesmo tipo de proteção) que os que passaram não têm.')
  }
  console.log('')
}

await main()
