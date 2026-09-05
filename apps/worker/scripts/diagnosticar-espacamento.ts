/**
 * ESTE EXPERIMENTO JÁ RODOU E DECIDIU. O resultado está em `ACHADOS.md`,
 * achado A1, com as duas colunas lado a lado. Em uma linha: a hipótese do
 * ritmo se CONFIRMOU para a camada de rede — 8 dos 12 domínios que estouravam
 * o `page.goto` em rajada carregaram limpos em 7 a 50 segundos espaçados, e a
 * `tracksmith` (controle positivo, passou nas duas condições) caiu de 140,3s
 * para 17,0s, com o `identify` indo de 75-78s para 9,4s. Mesmo domínio, mesmo
 * código, mesmo IP: a diferença foi só não estar numa fila de 227.
 *
 * E o que apareceu embaixo não foi `entrou`, foi `robots.txt bloqueia:
 * /cart.js, /cart/add.js, /checkout` — em 8 de 8 dos que destravaram. O teto
 * da Camada 1 não é o ritmo, é o robots respeitado de propósito (§2.3). O
 * ritmo só estava escondendo isso atrás de timeout.
 *
 * Ficou de pé uma coisa só: `pantys.com.br`, `brooklinen.com` e
 * `colourpop.com` estouram os 120s da §14 NA DETECÇÃO DE PLATAFORMA mesmo com
 * 2,5 min de intervalo. 3 de 12, sem explicação. É para isso que este script
 * ainda serve — rodar contra uma amostra montada em cima DESSES, não em cima
 * dos que já se explicaram.
 *
 * ------------------------------------------------------------------------
 *
 * O raciocínio original, mantido porque é o que torna o resultado legível:
 * rede, User-Agent, redirect+corpo e recurso local (memória, processo de
 * Chromium) já tinham sido eliminados com evidência real da Fly — `livre`
 * estável em ~500-520MB de 962MB, `chromium` nunca acima de 1, e o primeiro
 * timeout da segunda cobertura aparecendo já na posição #10, com a memória
 * praticamente igual à do início. Não deu tempo de faltar recurso nenhum. O
 * que sobrava por eliminação era VOLUME e RITMO: os mesmos domínios
 * carregavam limpos isolados e travavam em 227 pedidos do mesmo IP em ~2h —
 * assinatura de reputação de IP por taxa de pedidos, comum em CDN grande.
 *
 * ONDE RODAR IMPORTA MAIS QUE TUDO AQUI. A reputação em jogo é a do IP de
 * produção (datacenter da Fly). Rodar na máquina de casa testa outro IP,
 * residencial, com reputação diferente — passaria e não provaria nada sobre
 * o motor. Sempre:
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-espacamento"
 *
 * TAMANHO E RITMO SÃO O TRADE-OFF, e os dois são configuráveis porque a
 * escolha certa depende de quanto tempo se tem, não do código:
 *
 *   RAIO_X_ESPACAMENTO_N    quantos domínios da amostra rodar (padrão: 12)
 *   RAIO_X_ESPACAMENTO_MS   intervalo entre eles (padrão: 150000 = 2,5 min)
 *
 * A conta é direta: tempo ≈ N × (intervalo + ~30s de tentativa). Com o
 * padrão, 12 domínios levam ~30 min; os 60 da amostra levariam ~2h30.
 *
 * E um alerta que o experimento inteiro depende de respeitar: NÃO baixe o
 * intervalo para caber mais domínios no mesmo tempo. Na cobertura original,
 * 227 domínios em ~2h dão ~32s entre pedidos. Um intervalo dessa ordem
 * reproduz a rajada em vez de contrastar com ela — o resultado não
 * distinguiria hipótese nenhuma, e o tempo gasto não compraria informação.
 * Menos domínios com intervalo grande vale mais que muitos domínios com
 * intervalo pequeno.
 */

import { medirLeitura } from './medir-cobertura.ts'

/**
 * Amostra da ÚLTIMA cobertura, 60 domínios: metade BR, metade internacional,
 * espalhados do começo ao fim da lista original — para não confundir
 * "espaçado ajudou" com "esta parte da lista era mais fácil".
 *
 * Três marcadores de propósito, que fazem a leitura do resultado sozinha:
 *
 *   gymshark / everlane / brooklinen — travaram nas DUAS coberturas e
 *     passaram no teste isolado. São o coração da hipótese: se eles
 *     passarem espaçados, o padrão se repete e o ritmo é a causa.
 *   simpleorganic / pantys — posições #10 e #11, os PRIMEIROS a travar na
 *     cobertura. Se o gatilho fosse acúmulo, cedo demais para acumular.
 *   tracksmith — PASSOU na cobertura. Controle positivo: se ele falhar
 *     agora, alguma coisa mudou no ambiente e o resto da leitura cai junto.
 */
const AMOSTRA = [
  /* A ORDEM É O EXPERIMENTO, e mexer nela quebra a rodada de quem usa o
     padrão. Ela foi refeita depois que a primeira rodada explicou 8 dos 12:
     os que destravaram espaçados já deram a resposta deles (robots.txt) e não
     compram mais informação nenhuma. Os quatro primeiros agora são a pergunta
     que ficou de pé, e com `RAIO_X_ESPACAMENTO_N=4` a rodada leva ~10 min em
     vez de 30.

     Os três primeiros travam nos 120s MESMO espaçados. Com a trilha do
     orçamento (`lib/deadline.ts`), cada um agora diz em que etapa parou — que
     é o dado que faltava para escolher entre preflight lento, cadeia de
     redirects, `page.goto`, `page.content` e classificação, todos escondidos
     antes atrás do mesmo rótulo.

     O quarto é o controle positivo, e sem ele a rodada não se lê: a
     `tracksmith` passou nas duas condições, e foi a queda dela de 140,3s
     (identify 75-78s) para 17,0s (identify 9,4s) que provou o efeito do
     ritmo. Se ela falhar agora, mudou alguma coisa no ambiente e o resto da
     leitura cai junto. */
  'pantys.com.br', // 123.2s DEADLINE_EXCEEDED mesmo espaçado — sem explicação
  'brooklinen.com', // 122.8s DEADLINE_EXCEEDED mesmo espaçado — sem explicação
  'colourpop.com', // 124.0s DEADLINE_EXCEEDED mesmo espaçado — sem explicação
  'tracksmith.com', // PASSOU nas duas condições — controle positivo
  /* Daqui pra baixo, os que JÁ se explicaram: espaçados, responderam
     `robots.txt bloqueia` em 7 a 50s (achado A1). Ficam na lista só para
     confirmar que o resultado deles não mudou. */
  'gymshark.com',
  'simpleorganic.com.br',
  'everlane.com',
  'steamtoy.com.br',
  'rothys.com',
  'ekomat.com.br',
  'fearofgod.com',
  'noahny.com',
  // daqui pra baixo, só amplia a amostra — BR e internacional alternados
  'loft111.com.br',
  'skims.com',
  'bluntbrasil.com.br',
  'glossier.com',
  'labellamafia.com.br',
  'ruggable.com',
  'artwalk.com.br',
  'bombas.com',
  'sobrebarba.com.br',
  'pangaia.com',
  'bestbaby.com.br',
  'madhappy.com',
  'divinobebe.com.br',
  'parachutehome.com',
  'minimalistashop.com.br',
  'hexclad.com',
  'nutrify.com.br',
  'ridge.com',
  'lojadosuplemento.com.br',
  'bellroy.com',
  'casadocodigo.com.br',
  'missoma.com',
  'hubjoias.com.br',
  'thursdayboots.com',
  'basico.com',
  'princesspolly.com',
  'mofficer.com.br',
  'peakdesign.com',
  'patbo.com',
  'keychron.com',
  'basicamente.com.br',
  'huel.com',
  'pampili.com.br',
  'liquiddeath.com',
  'bocarosa.com.br',
  'kosas.com',
  'amaro.com',
  'iliabeauty.com',
  'gringa.com.br',
  'article.com',
  'zerezes.com.br',
  'yeti.com',
  'soprata.com.br',
  'mous.co',
  'ou.com.br',
  'debetti.com.br',
  'boldsnacks.com.br',
  'cadernointeligente.com.br',
] as const

const INTERVALO_PADRAO_MS = 150_000 // 2,5 min
const QUANTOS_PADRAO = 12

function inteiroDoAmbiente(chave: string, padrao: number, env: NodeJS.ProcessEnv = process.env): number {
  const bruto = env[chave]
  if (bruto === undefined || bruto.trim() === '') return padrao
  const n = Number(bruto)
  /* Valor inválido não vira o padrão em silêncio: quem escreveu
     `RAIO_X_ESPACAMENTO_N=doze` quis mudar alguma coisa, e rodar 30 minutos
     com a configuração errada sem avisar é a pior das duas saídas. */
  if (!Number.isFinite(n) || n <= 0) {
    console.error(`[espacamento] ${chave}="${bruto}" não é um número positivo — usando o padrão ${padrao}`)
    return padrao
  }
  return Math.floor(n)
}

function pausa(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

async function main(): Promise<void> {
  const intervaloMs = inteiroDoAmbiente('RAIO_X_ESPACAMENTO_MS', INTERVALO_PADRAO_MS)
  const quantos = Math.min(inteiroDoAmbiente('RAIO_X_ESPACAMENTO_N', QUANTOS_PADRAO), AMOSTRA.length)
  const alvos = AMOSTRA.slice(0, quantos)
  const estimativaMin = Math.round((quantos * (intervaloMs + 30_000)) / 60_000)

  console.log('')
  console.log(`espaçando ${alvos.length} de ${AMOSTRA.length} domínios, ${intervaloMs / 1000}s entre cada um`)
  console.log(`estimativa: ~${estimativaMin} min`)
  /* O intervalo da cobertura original era ~32s. Abaixo disso o teste deixa
     de contrastar com a rajada e passa a reproduzi-la — quem configurou
     assim precisa saber ANTES de esperar, não depois de ler um resultado
     que não distingue nada. */
  if (intervaloMs < 60_000) {
    console.log('')
    console.log(`  AVISO: ${intervaloMs / 1000}s é perto do ritmo da própria cobertura que travou (~32s).`)
    console.log('  Um resultado "travou de novo" aqui não distingue ritmo de causa fixa — o')
    console.log('  experimento perde o poder de decidir. Intervalo de 2 min ou mais é o que separa.')
  }
  console.log('')

  let entraram = 0
  let travaramDeNovo = 0
  let outraCoisa = 0

  for (const [indice, hostname] of alvos.entries()) {
    if (indice > 0) {
      process.stdout.write(`  (esperando ${intervaloMs / 1000}s antes do próximo...) `)
      await pausa(intervaloMs)
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
  linha(`entrou (não travou mais, espaçado): ${entraram} de ${alvos.length}`)
  linha(`travou de novo mesmo espaçado: ${travaramDeNovo} de ${alvos.length}`)
  linha(`outro desfecho (mudou de causa): ${outraCoisa} de ${alvos.length}`)
  console.log('')

  if (entraram >= alvos.length * 0.4) {
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
