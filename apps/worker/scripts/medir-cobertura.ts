/**
 * A pergunta que o Bruno fez: "as pessoas vão colocar a URL que elas quiserem
 * ver, e o sistema vai simplesmente não funcionar?" Isto mede isso — não em
 * uma loja, em muitas, porque é a distribuição que decide se dá pra lançar.
 *
 *   fly ssh console -a raio-x-motor -C "npm run medir-cobertura"
 *
 * DUAS CAMADAS, por um limite que não é técnico, é de consentimento:
 *
 * Camada 1 — LEITURA, sem autorização de ninguém. Roda contra qualquer loja
 * da lista abaixo: identifica a plataforma, lê a página do produto, e para
 * por desenho antes do carrinho — porque ninguém pela loja autorizou ir além.
 * É a metade da jornada onde apareceu boa parte do que já quebrou: kith
 * travada em "2 das 13 checagens", sallve estourando os 120s, sobreposição na
 * entrada. Mede se o robô CONSEGUE ENTRAR, não se a compra completa funciona.
 *
 * Camada 2 — CONSENTIDO, só em loja com aceite de verdade. É a única que
 * chega em carrinho, checkout e pagamento — e só roda para quem está no
 * arquivo `lojas-consentidas.json` (fora do repositório, o Bruno passa por
 * fora do chat). Sem esse arquivo, esta camada fica de fora do relatório e
 * isto é dito, não escondido: fingir cobertura que não existe seria pior do
 * que reportar menos.
 *
 * Antes de cada loja da Camada 1 virar auditoria, passa pelo `detect`: mais
 * barato que uma auditoria (não abre carrinho), mas ainda um toque real —
 * sobe o Chromium e carrega a home. Filtra quem não é Shopify e quem o
 * robots.txt já bloqueia antes de qualquer coisa custar mais caro. A lista de
 * candidatos abaixo veio de busca, não de memória: nomes que "parecem certos"
 * de memória já causaram desperdício de tentativa antes (a loja demo do
 * Shopify que bloqueou o robô). O `detect` é o que torna seguro eu errar.
 *
 * §2.2 protegida por construção: cada domínio roda no máximo UMA VEZ neste
 * script (Set, sem repetição na lista), e a auditoria em si grava no ledger de
 * 24h — uma segunda tentativa no mesmo domínio é recusada pelo próprio motor,
 * não só por este script.
 *
 * RISCO A SABER: o ledger fica em `/tmp` no contêiner da Fly, que é apagado a
 * cada deploy. Não dê deploy enquanto isto está rodando — um redeploy no meio
 * apaga o registro e um re-run auditaria a mesma loja de novo. O script
 * imprime cada resultado NA HORA, então mesmo perdendo o arquivo o que já
 * mediu fica no terminal.
 *
 * SEGUNDA RODADA: a primeira devolveu 4 de 227 entrando, mas a maioria dos
 * timeouts eliminou três hipóteses de bloqueio por loja (rede, User-Agent,
 * redirect+corpo — todas rápidas e limpas na Fly, para os mesmos domínios) e
 * um teste final com o Chromium de verdade não reproduziu o travamento em
 * NENHUM dos quatro, incluindo três que tinham travado antes.
 *
 * Relendo o log da primeira rodada EM ORDEM: os ~9 primeiros candidatos
 * saíram limpos, e a partir do 13º o timeout de 30s virou o desfecho
 * dominante pro resto da lista inteira. Essa é a assinatura de recurso se
 * esgotando ao longo de uma rodada longa e sequencial — memória, processo de
 * Chromium não fechando direito — não de bloqueio por loja. `snapshotDeRecursos`,
 * mais abaixo, imprime memória livre, RSS do processo e contagem de
 * Chromium antes de CADA candidato, para esta rodada trazer o rastro que
 * faltou na primeira: se o recurso realmente cai ao longo da lista, e em que
 * posição a queda bate com o início dos timeouts.
 */

import { detect } from '../src/detect.ts'
import { audit, type AuditResult } from '../src/audit.ts'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import { execSync } from 'node:child_process'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

/**
 * Já auditadas de verdade nas rodadas manuais anteriores. Rodar de novo
 * violaria a mesma regra que este script existe para respeitar — mesmo em
 * modo leitura, que é mais leve.
 */
const JA_AUDITADAS = new Set([
  'allbirds.com',
  'kith.com',
  'circulei.com.br',
  'sallve.com.br',
  'uselinus.com.br',
])

/**
 * Candidatos pra Camada 1 (leitura, sem autorização de ninguém).
 *
 * Três origens, marcadas em `origem` porque o relatório separa por elas — a
 * pergunta "funciona pra loja brasileira" e "o motor aguenta tema/anti-bot
 * variado" são perguntas diferentes, e misturar as duas escondia qual das
 * duas o número respondia:
 *
 * 'br'            — minha lista original (busca, não memória) + a segunda
 *                    leva que o Bruno passou. É o público real da ferramenta.
 * 'internacional' — a primeira leva que o Bruno passou: marcas globais
 *                    grandes, prováveis anti-bot de verdade. Boa pra robustez
 *                    de tema, ruim pra representar o produto (não é Brasil,
 *                    não tem Pix nem CPF — o que a ferramenta mede).
 *
 * As DUAS listas do Bruno vieram com "o dono autorizou" embaixo de cada
 * linha — e isso NÃO virou Camada 2. Aceite de verdade é por loja, de quem
 * tem autoridade sobre ELA; uma linha repetida sob duzentos domínios de
 * marca que não é dele não é isso, é a mesma coisa que o `Aceite` existe pra
 * impedir. Por isso as duas entram aqui, na camada que não pede consentimento
 * — leitura, sem carrinho.
 *
 * Removida desta lista: a loja que o comentário de `cooldown.ts` já registra
 * como hostilizada por auditoria repetida antes (passou a servir desafio da
 * Cloudflare). Tocar de novo, mesmo em leitura, seria repetir o mesmo erro
 * que aquele arquivo existe para não deixar acontecer de novo.
 *
 * O `detect`, mais abaixo, confirma cada uma antes de custar uma auditoria —
 * então um nome errado aqui (loja que fechou, que não é Shopify de verdade,
 * que trocou de plataforma) só produz um "descartado", não desperdício.
 *
 * SÃO 227 CANDIDATOS. Isto não é mais os "45–60 minutos" que eu tinha
 * estimado pra uma lista de 20–30 — pode passar de uma hora, e marca grande
 * com anti-bot de verdade tende a DEMORAR pra falhar (esperar o desafio, não
 * rejeitar na hora), não só falhar rápido. É seguro interromper com Ctrl+C a
 * qualquer momento: cada linha imprime na hora que termina, e §2.2 está
 * protegida por domínio individual, não pelo total da lista — parar na
 * metade não deixa nada em estado ruim, só mede menos.
 */
interface Candidato {
  hostname: string
  origem: 'br' | 'internacional'
}

const CANDIDATOS_LEITURA: Candidato[] = [
  { hostname: 'loft111.com.br', origem: 'br' },
  { hostname: 'bluntbrasil.com.br', origem: 'br' },
  { hostname: 'shui.com.br', origem: 'br' },
  { hostname: 'labellamafia.com.br', origem: 'br' },
  { hostname: 'shopinsecta.com', origem: 'br' },
  { hostname: 'lksneakers.com.br', origem: 'br' },
  { hostname: 'artwalk.com.br', origem: 'br' },
  { hostname: 'youridstore.com.br', origem: 'br' },
  { hostname: 'sobrebarba.com.br', origem: 'br' },
  { hostname: 'simpleorganic.com.br', origem: 'br' },
  { hostname: 'pantys.com.br', origem: 'br' },
  { hostname: 'bestbaby.com.br', origem: 'br' },
  { hostname: 'divinobebe.com.br', origem: 'br' },
  { hostname: 'steamtoy.com.br', origem: 'br' },
  { hostname: 'minimalistashop.com.br', origem: 'br' },
  { hostname: 'coffeemais.com', origem: 'br' },
  { hostname: 'storefitsuplementos.com.br', origem: 'br' },
  { hostname: 'nutrify.com.br', origem: 'br' },
  { hostname: 'fabricadesuplementos.com.br', origem: 'br' },
  { hostname: 'lojadosuplemento.com.br', origem: 'br' },
  { hostname: 'casadocodigo.com.br', origem: 'br' },
  { hostname: 'worksemijoias.com.br', origem: 'br' },
  { hostname: 'hubjoias.com.br', origem: 'br' },
  { hostname: 'carlasoarespetshop.myshopify.com', origem: 'br' },
  { hostname: 'petchico.myshopify.com', origem: 'br' },
  { hostname: 'compresoagora.myshopify.com', origem: 'br' },
  { hostname: 'lojas-decor.myshopify.com', origem: 'br' },
  { hostname: 'megatonsuplementos.myshopify.com', origem: 'br' },
  { hostname: '5494f5-4.myshopify.com', origem: 'br' },
  { hostname: 'basico.com', origem: 'br' },
  { hostname: 'mofficer.com.br', origem: 'br' },
  { hostname: 'patbo.com', origem: 'br' },
  { hostname: 'mondepars.com', origem: 'br' },
  { hostname: 'duas.com.br', origem: 'br' },
  { hostname: 'basicamente.com.br', origem: 'br' },
  { hostname: 'minimalista.com.br', origem: 'br' },
  { hostname: 'pampili.com.br', origem: 'br' },
  { hostname: 'mooui.com.br', origem: 'br' },
  { hostname: 'bocarosa.com.br', origem: 'br' },
  { hostname: 'ollie.com.br', origem: 'br' },
  { hostname: 'amaro.com', origem: 'br' },
  { hostname: 'gringa.com.br', origem: 'br' },
  { hostname: 'zerezes.com.br', origem: 'br' },
  { hostname: 'stanley1913.com.br', origem: 'br' },
  { hostname: 'soprata.com.br', origem: 'br' },
  { hostname: 'zissou.com.br', origem: 'br' },
  { hostname: 'weasy.com.br', origem: 'br' },
  { hostname: 'ou.com.br', origem: 'br' },
  { hostname: 'modalibaby.com.br', origem: 'br' },
  { hostname: 'zaffdesign.com.br', origem: 'br' },
  { hostname: 'venicacasa.com.br', origem: 'br' },
  { hostname: 'debetti.com.br', origem: 'br' },
  { hostname: 'cauchocolates.com.br', origem: 'br' },
  { hostname: 'boldsnacks.com.br', origem: 'br' },
  { hostname: 'z2foods.com.br', origem: 'br' },
  { hostname: 'estudiopapel.com.br', origem: 'br' },
  { hostname: 'cadernointeligente.com.br', origem: 'br' },
  { hostname: 'nerdaocubo.com.br', origem: 'br' },
  { hostname: 'ironstudios.com.br', origem: 'br' },
  { hostname: 'fiberoficial.com.br', origem: 'br' },
  { hostname: 'ekomat.com.br', origem: 'br' },
  { hostname: 'traxart.com.br', origem: 'br' },
  { hostname: 'dragonpharmabrasil.com', origem: 'br' },
  { hostname: 'apicecosmeticos.com.br', origem: 'br' },
  { hostname: 'gymshark.com', origem: 'internacional' },
  { hostname: 'skims.com', origem: 'internacional' },
  { hostname: 'alo.com', origem: 'internacional' },
  { hostname: 'vuoriclothing.com', origem: 'internacional' },
  { hostname: 'mejuri.com', origem: 'internacional' },
  { hostname: 'glossier.com', origem: 'internacional' },
  { hostname: 'brooklinen.com', origem: 'internacional' },
  { hostname: 'drsquatch.com', origem: 'internacional' },
  { hostname: 'ruggable.com', origem: 'internacional' },
  { hostname: 'carawayhome.com', origem: 'internacional' },
  { hostname: 'poppi.com', origem: 'internacional' },
  { hostname: 'nicekicks.com', origem: 'internacional' },
  { hostname: 'fashionnova.com', origem: 'internacional' },
  { hostname: 'fearofgod.com', origem: 'internacional' },
  { hostname: 'colourpop.com', origem: 'internacional' },
  { hostname: 'bombas.com', origem: 'internacional' },
  { hostname: 'rothys.com', origem: 'internacional' },
  { hostname: 'cutsclothing.com', origem: 'internacional' },
  { hostname: 'trueclassictees.com', origem: 'internacional' },
  { hostname: 'representclo.com', origem: 'internacional' },
  { hostname: 'pangaia.com', origem: 'internacional' },
  { hostname: 'goodamerican.com', origem: 'internacional' },
  { hostname: 'madhappy.com', origem: 'internacional' },
  { hostname: 'buckmason.com', origem: 'internacional' },
  { hostname: 'marine-layer.com', origem: 'internacional' },
  { hostname: 'chubbiesshorts.com', origem: 'internacional' },
  { hostname: 'rhones.com', origem: 'internacional' },
  { hostname: 'tentree.com', origem: 'internacional' },
  { hostname: 'parachutehome.com', origem: 'internacional' },
  { hostname: 'ourplace.com', origem: 'internacional' },
  { hostname: 'madeincookware.com', origem: 'internacional' },
  { hostname: 'hexclad.com', origem: 'internacional' },
  { hostname: 'blueland.com', origem: 'internacional' },
  { hostname: 'bite.com', origem: 'internacional' },
  { hostname: 'hismileteeth.com', origem: 'internacional' },
  { hostname: 'nativecos.com', origem: 'internacional' },
  { hostname: 'manscaped.com', origem: 'internacional' },
  { hostname: 'beardbrand.com', origem: 'internacional' },
  { hostname: 'ridge.com', origem: 'internacional' },
  { hostname: 'bellroy.com', origem: 'internacional' },
  { hostname: 'puravidabracelets.com', origem: 'internacional' },
  { hostname: 'analuisa.com', origem: 'internacional' },
  { hostname: 'missoma.com', origem: 'internacional' },
  { hostname: 'vitalydesign.com', origem: 'internacional' },
  { hostname: 'jaxxon.com', origem: 'internacional' },
  { hostname: 'koio.co', origem: 'internacional' },
  { hostname: 'thursdayboots.com', origem: 'internacional' },
  { hostname: 'culturekings.com', origem: 'internacional' },
  { hostname: 'princesspolly.com', origem: 'internacional' },
  { hostname: 'meshki.us', origem: 'internacional' },
  { hostname: 'whitefoxboutique.com', origem: 'internacional' },
  { hostname: 'ohpolly.com', origem: 'internacional' },
  { hostname: 'lounge.com', origem: 'internacional' },
  { hostname: 'cupshe.com', origem: 'internacional' },
  { hostname: 'frankiesbikinis.com', origem: 'internacional' },
  { hostname: 'kulani-kinis.com', origem: 'internacional' },
  { hostname: 'tropicfeel.com', origem: 'internacional' },
  { hostname: 'peakdesign.com', origem: 'internacional' },
  { hostname: 'nomadgoods.com', origem: 'internacional' },
  { hostname: 'mous.co', origem: 'internacional' },
  { hostname: 'casetify.com', origem: 'internacional' },
  { hostname: 'dbrand.com', origem: 'internacional' },
  { hostname: 'satechi.net', origem: 'internacional' },
  { hostname: 'grovemade.com', origem: 'internacional' },
  { hostname: 'ugmonk.com', origem: 'internacional' },
  { hostname: 'keychron.com', origem: 'internacional' },
  { hostname: 'secretlab.co', origem: 'internacional' },
  { hostname: 'huel.com', origem: 'internacional' },
  { hostname: 'magicspoon.com', origem: 'internacional' },
  { hostname: 'drinklmnt.com', origem: 'internacional' },
  { hostname: 'drinkag1.com', origem: 'internacional' },
  { hostname: 'bloomnu.com', origem: 'internacional' },
  { hostname: 'ghostlifestyle.com', origem: 'internacional' },
  { hostname: 'alaninu.com', origem: 'internacional' },
  { hostname: 'drinkolipop.com', origem: 'internacional' },
  { hostname: 'drinkpoppi.com', origem: 'internacional' },
  { hostname: 'chamberlaincoffee.com', origem: 'internacional' },
  { hostname: 'deathwishcoffee.com', origem: 'internacional' },
  { hostname: 'mudwtr.com', origem: 'internacional' },
  { hostname: 'foursigmatic.com', origem: 'internacional' },
  { hostname: 'feastables.com', origem: 'internacional' },
  { hostname: 'liquiddeath.com', origem: 'internacional' },
  { hostname: 'gfuel.com', origem: 'internacional' },
  { hostname: 'graza.co', origem: 'internacional' },
  { hostname: 'flybyjing.com', origem: 'internacional' },
  { hostname: 'brightland.co', origem: 'internacional' },
  { hostname: 'fishwife.com', origem: 'internacional' },
  { hostname: 'shop.momofuku.com', origem: 'internacional' },
  { hostname: 'omsom.com', origem: 'internacional' },
  { hostname: 'bokksu.com', origem: 'internacional' },
  { hostname: 'milkbarstore.com', origem: 'internacional' },
  { hostname: 'summerfridays.com', origem: 'internacional' },
  { hostname: 'youthtothepeople.com', origem: 'internacional' },
  { hostname: 'supergoop.com', origem: 'internacional' },
  { hostname: 'kosas.com', origem: 'internacional' },
  { hostname: 'jonesroadbeauty.com', origem: 'internacional' },
  { hostname: 'saiehello.com', origem: 'internacional' },
  { hostname: 'tower28beauty.com', origem: 'internacional' },
  { hostname: 'iliabeauty.com', origem: 'internacional' },
  { hostname: 'meritbeauty.com', origem: 'internacional' },
  { hostname: 'ouai.com', origem: 'internacional' },
  { hostname: 'briogeohair.com', origem: 'internacional' },
  { hostname: 'functionofbeauty.com', origem: 'internacional' },
  { hostname: 'prose.com', origem: 'internacional' },
  { hostname: 'necessaire.com', origem: 'internacional' },
  { hostname: 'saltandstone.com', origem: 'internacional' },
  { hostname: 'snif.co', origem: 'internacional' },
  { hostname: 'dossier.co', origem: 'internacional' },
  { hostname: 'phlur.com', origem: 'internacional' },
  { hostname: 'boysmells.com', origem: 'internacional' },
  { hostname: 'bearaby.com', origem: 'internacional' },
  { hostname: 'helixsleep.com', origem: 'internacional' },
  { hostname: 'eightsleep.com', origem: 'internacional' },
  { hostname: 'burrow.com', origem: 'internacional' },
  { hostname: 'article.com', origem: 'internacional' },
  { hostname: 'revivalrugs.com', origem: 'internacional' },
  { hostname: 'thesill.com', origem: 'internacional' },
  { hostname: 'bloomscape.com', origem: 'internacional' },
  { hostname: 'branchfurniture.com', origem: 'internacional' },
  { hostname: 'rumpl.com', origem: 'internacional' },
  { hostname: 'yeti.com', origem: 'internacional' },
  { hostname: 'hydroflask.com', origem: 'internacional' },
  { hostname: 'owalalife.com', origem: 'internacional' },
  { hostname: 'fellowproducts.com', origem: 'internacional' },
  { hostname: 'ember.com', origem: 'internacional' },
  { hostname: 'hyperice.com', origem: 'internacional' },
  { hostname: 'bala.com', origem: 'internacional' },
  { hostname: 'onnit.com', origem: 'internacional' },
  { hostname: 'tenthousand.cc', origem: 'internacional' },
  { hostname: 'bornprimitive.com', origem: 'internacional' },
  { hostname: 'goruck.com', origem: 'internacional' },
  { hostname: 'tracksmith.com', origem: 'internacional' },
  { hostname: 'banditrunning.com', origem: 'internacional' },
  { hostname: 'janji.com', origem: 'internacional' },
  { hostname: 'maap.cc', origem: 'internacional' },
  { hostname: 'statebicycle.com', origem: 'internacional' },
  { hostname: 'pitviper.com', origem: 'internacional' },
  { hostname: 'goodr.com', origem: 'internacional' },
  { hostname: 'sunski.com', origem: 'internacional' },
  { hostname: 'pair-eyewear.com', origem: 'internacional' },
  { hostname: 'huckberry.com', origem: 'internacional' },
  { hostname: 'bespokepost.com', origem: 'internacional' },
  { hostname: 'everlane.com', origem: 'internacional' },
  { hostname: 'thirdlove.com', origem: 'internacional' },
  { hostname: 'knix.com', origem: 'internacional' },
  { hostname: 'meundies.com', origem: 'internacional' },
  { hostname: 'mackweldon.com', origem: 'internacional' },
  { hostname: 'saxxunderwear.com', origem: 'internacional' },
  { hostname: 'byltbasics.com', origem: 'internacional' },
  { hostname: 'westernrise.com', origem: 'internacional' },
  { hostname: 'mizzenandmain.com', origem: 'internacional' },
  { hostname: 'propercloth.com', origem: 'internacional' },
  { hostname: 'stateandliberty.com', origem: 'internacional' },
  { hostname: 'mnml.la', origem: 'internacional' },
  { hostname: 'pleasuresnow.com', origem: 'internacional' },
  { hostname: 'teddyfresh.com', origem: 'internacional' },
  { hostname: 'ripndipclothing.com', origem: 'internacional' },
  { hostname: 'ksubi.com', origem: 'internacional' },
  { hostname: 'johnelliott.com', origem: 'internacional' },
  { hostname: 'noahny.com', origem: 'internacional' },
  { hostname: 'rowingblazers.com', origem: 'internacional' },
  { hostname: 'corridornyc.com', origem: 'internacional' },
  { hostname: 'toddsnyder.com', origem: 'internacional' },
]

export interface Consentida {
  url: string
  em: string
  texto: string
}

/**
 * Camada 2. Arquivo fora do repositório — ver `.gitignore`. Ausente é estado
 * normal, não erro: significa que ninguém deu aceite ainda.
 */
/**
 * A loja do próprio Bruno, criada especificamente pra medir a Camada 2 sem
 * depender de aceite de terceiro. É uma loja em plano pago criada direto no
 * shopify.com: loja de desenvolvimento do Shopify Partners não serve, porque
 * fica presa atrás da senha de vitrine e não tem como ativar plano por dentro
 * da organização Partner.
 *
 * Vem de variável de ambiente, não do arquivo `lojas-consentidas.json` — e é
 * ISSO que a faz sobreviver a um redeploy. O arquivo fica fora do
 * repositório de propósito, porque dado de aceite de TERCEIRO nunca deveria
 * ir pro git público. Esta loja não tem esse problema: é do próprio dono do
 * projeto, autorizando a própria loja, então uma variável de ambiente
 * versionada é o lugar certo — o mesmo raciocínio que já vale pra
 * `RAIO_X_ORIGENS`.
 */
function lojaPropriaDoAmbiente(env: NodeJS.ProcessEnv = process.env): Consentida | null {
  const url = env['RAIO_X_LOJA_PROPRIA']
  if (!url) return null
  return {
    url,
    em: '2026-09-05T00:00:00Z', // quando o Bruno criou a loja e autorizou, nesta conversa
    texto: 'Loja própria em plano pago (criada direto no shopify.com), publicada para medir a Camada 2 do Raio-X do Checkout.',
  }
}

export async function carregarConsentidas(
  caminho: string = path.join(AQUI, 'lojas-consentidas.json'),
  env: NodeJS.ProcessEnv = process.env,
): Promise<Consentida[]> {
  const daPropria = lojaPropriaDoAmbiente(env)
  const doArquivo = await (async (): Promise<Consentida[]> => {
    try {
      const bruto = await readFile(caminho, 'utf8')
      const lista = JSON.parse(bruto) as unknown
      if (!Array.isArray(lista)) throw new Error('esperava uma lista')
      return lista as Consentida[]
    } catch (erro) {
      if ((erro as NodeJS.ErrnoException).code === 'ENOENT') return []
      console.error(`[cobertura] lojas-consentidas.json existe mas não deu pra ler: ${String(erro)}`)
      return []
    }
  })()
  return daPropria ? [daPropria, ...doArquivo] : doArquivo
}

export type DesfechoLeitura =
  | { faixa: 'entrou'; detalhe: string }
  /* Cobre DOIS casos diferentes, e o `detalhe` é onde se distingue um do
     outro: (a) confirmada como outra coisa — não shopify, robots bloqueia,
     sem adapter — e (b) o `detect` nem conseguiu falar com a loja — ar,
     DNS errado, porta fechada. Juntei os dois porque nenhum dos dois chegou
     a ser confirmado como candidato de verdade, mas o texto de cada linha diz
     qual dos dois foi, e o resumo por código de erro (mais abaixo) também. */
  | { faixa: 'descartada-no-detect'; detalhe: string }
  | { faixa: 'abortou'; codigo: string; detalhe: string }

/**
 * Uma linha do funil da Camada 1.
 *
 * Recebe a URL pronta (não monta `https://` sozinha) para o teste poder
 * apontar pra loja falsa em `http://127.0.0.1:PORTA`, sem precisar mentir um
 * hostname que não existe.
 */
export async function medirLeitura(url: string): Promise<{ desfecho: DesfechoLeitura; ms: number }> {
  const t0 = Date.now()

  const d = await detect(url, { headed: false })
  if (!d.ok) {
    return {
      ms: Date.now() - t0,
      desfecho: { faixa: 'descartada-no-detect', detalhe: `${d.errorCode}: ${d.errorReason}` },
    }
  }
  if (d.platform.id !== 'shopify') {
    return {
      ms: Date.now() - t0,
      desfecho: { faixa: 'descartada-no-detect', detalhe: `plataforma é ${d.platform.id}, não shopify` },
    }
  }
  if (!d.journeySupported) {
    return {
      ms: Date.now() - t0,
      desfecho: { faixa: 'descartada-no-detect', detalhe: 'shopify, mas sem adapter de jornada' },
    }
  }
  if (d.robotsPlan.blockedPaths.length > 0) {
    return {
      ms: Date.now() - t0,
      desfecho: {
        faixa: 'descartada-no-detect',
        detalhe: `robots.txt bloqueia: ${d.robotsPlan.blockedPaths.join(', ')}`,
      },
    }
  }

  const r = await audit(url, { modo: 'leitura', headed: false, outDir: '/tmp/raio-x-cobertura' })
  if (r.status === 'failed' || !r.ok) {
    return {
      ms: Date.now() - t0,
      desfecho: { faixa: 'abortou', codigo: r.errorCode ?? 'DESCONHECIDO', detalhe: r.errorReason ?? '' },
    }
  }
  const identify = r.steps.find((s) => s.id === 'open-home')
  const produto = r.steps.find((s) => s.id === 'open-product')
  return {
    ms: Date.now() - t0,
    desfecho: {
      faixa: 'entrou',
      detalhe: `identify ${identify?.ms ?? '?'}ms · produto ${produto?.ms ?? '?'}ms · ${r.checks?.applicable ?? 0} checagem(ns) possível(is)`,
    },
  }
}

export async function medirConsentida(loja: Consentida): Promise<{ hostname: string; resultado: AuditResult }> {
  const hostname = new URL(loja.url).hostname
  const resultado = await audit(loja.url, {
    modo: 'consentido',
    aceite: { em: loja.em, url: loja.url, texto: loja.texto },
    headed: false,
    outDir: '/tmp/raio-x-cobertura',
  })
  return { hostname, resultado }
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

/**
 * Achado depois de rodar `diagnosticar-chromium` contra 4 domínios em
 * isolado: nenhum travou, nem os que tinham travado na cobertura. Isso
 * derruba "bloqueio determinístico por loja" e aponta para o contrário —
 * degradação ao longo de uma rodada LONGA e sequencial. Relendo a primeira
 * rodada em ordem de execução: as 9 primeiras saíram limpas, a partir da
 * 13ª o timeout de 30s vira o desfecho dominante pro resto da lista. Isso é
 * a assinatura de recurso se esgotando (memória, processo zumbi de
 * Chromium), não de anti-bot reconhecendo loja específica.
 *
 * Esta função imprime memória livre do sistema, RSS do processo Node, e
 * quantos processos de Chromium estão de pé ANTES de cada candidato — para
 * a próxima rodada trazer o rastro que faltou na primeira.
 */
function snapshotDeRecursos(): string {
  const livre = (os.freemem() / 1024 ** 2).toFixed(0)
  const total = (os.totalmem() / 1024 ** 2).toFixed(0)
  const rss = (process.memoryUsage().rss / 1024 ** 2).toFixed(0)
  let chromiums = '?'
  try {
    // `-f` casa no caminho inteiro do processo, não só no nome — o binário
    // do Playwright roda de um caminho longo dentro do cache do npx.
    chromiums = execSync('pgrep -c -f chrome', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    // pgrep sem match sai com código != 0 — não é falha, é zero processos.
    chromiums = '0'
  }
  return `livre ${livre}/${total}MB · rss-node ${rss}MB · chromium ${chromiums}`
}

/**
 * Pular a Camada 1 inteira (227 candidatos, 1-2h) quando o interesse do
 * momento é só a Camada 2 — como testar a loja própria que acabou de nascer,
 * sem esperar a lista toda de novo.
 */
function pularCamada1(env: NodeJS.ProcessEnv = process.env): boolean {
  return env['RAIO_X_PULAR_CAMADA1'] === '1'
}

async function main(): Promise<void> {
  if (pularCamada1()) {
    console.log('')
    console.log('CAMADA 1 pulada (RAIO_X_PULAR_CAMADA1=1) — indo direto pra Camada 2')
  } else {
    await rodarCamada1()
  }
  await rodarCamada2()
}

async function rodarCamada1(): Promise<void> {
  console.log('')
  console.log('CAMADA 1 — leitura, sem autorização de ninguém')
  console.log('quantas lojas o robô consegue identificar e ler, de uma lista que eu não escolhi olhando pra trás')
  console.log('')

  const vistos = new Set<string>()
  const candidatos: Candidato[] = []
  for (const c of CANDIDATOS_LEITURA) {
    if (JA_AUDITADAS.has(c.hostname) || vistos.has(c.hostname)) continue
    vistos.add(c.hostname)
    candidatos.push(c)
  }
  const pulados = CANDIDATOS_LEITURA.length - candidatos.length
  if (pulados > 0) {
    console.log(`  (${pulados} eram duplicata ou já tinham sido auditadas antes — §2.2)`)
  }
  console.log(`  ${candidatos.length} candidatos (${candidatos.filter((c) => c.origem === 'br').length} br, ` +
    `${candidatos.filter((c) => c.origem === 'internacional').length} internacional)`)
  console.log('')

  type Contagem = Record<DesfechoLeitura['faixa'], number>
  const zerado = (): Contagem => ({ entrou: 0, 'descartada-no-detect': 0, abortou: 0 })
  const porFaixa = zerado()
  const porFaixaEOrigem: Record<Candidato['origem'], Contagem> = { br: zerado(), internacional: zerado() }
  const abortosPorCodigo = new Map<string, number>()

  for (const [indice, { hostname, origem }] of candidatos.entries()) {
    console.log(`  #${indice + 1} — ${snapshotDeRecursos()}`)
    process.stdout.write(`  [${origem === 'br' ? 'BR' : 'IN'}] ${hostname.padEnd(30)} `)
    const { desfecho, ms } = await medirLeitura(`https://${hostname}`)
    porFaixa[desfecho.faixa]++
    porFaixaEOrigem[origem][desfecho.faixa]++
    const tempo = `${(ms / 1000).toFixed(1)}s`.padStart(6)
    if (desfecho.faixa === 'entrou') {
      console.log(`${tempo}  ENTROU        ${desfecho.detalhe}`)
    } else if (desfecho.faixa === 'descartada-no-detect') {
      console.log(`${tempo}  descartada    ${desfecho.detalhe}`)
    } else {
      console.log(`${tempo}  ABORTOU       ${desfecho.codigo}: ${desfecho.detalhe}`)
      abortosPorCodigo.set(desfecho.codigo, (abortosPorCodigo.get(desfecho.codigo) ?? 0) + 1)
    }
  }

  console.log('')
  console.log('  RESUMO DA CAMADA 1')
  linha(`entrou (identificou e leu produto): ${porFaixa.entrou} de ${candidatos.length}`)
  linha(`descartada no detect (não é shopify, robots bloqueia, sem adapter, ou nem respondeu): ${porFaixa['descartada-no-detect']}`)
  linha(`abortou depois de confirmada como shopify: ${porFaixa.abortou}`)
  console.log('')
  console.log('  por origem — são perguntas diferentes, não misturar:')
  for (const origem of ['br', 'internacional'] as const) {
    const c = porFaixaEOrigem[origem]
    const total = c.entrou + c['descartada-no-detect'] + c.abortou
    linha(`  ${origem === 'br' ? 'br  ' : 'intl'}: entrou ${c.entrou} de ${total} · descartada ${c['descartada-no-detect']} · abortou ${c.abortou}`)
  }
  if (abortosPorCodigo.size > 0) {
    console.log('  motivo dos abortos:')
    for (const [codigo, n] of abortosPorCodigo) linha(`  ${codigo}: ${n}`)
  }
  console.log('')
}

async function rodarCamada2(): Promise<void> {
  console.log('')
  console.log('CAMADA 2 — consentido, só com aceite real do responsável')
  const consentidas = await carregarConsentidas()
  if (consentidas.length === 0) {
    console.log('  nenhuma loja em lojas-consentidas.json ainda.')
    console.log('  a jornada de carrinho, checkout e pagamento NÃO tem cobertura além do que')
    console.log('  já foi rodado manualmente (allbirds, kith, circulei, sallve, uselinus) —')
    console.log('  e isto fica dito aqui, não escondido atrás de um número inflado.')
  } else {
    let leuPagamento = 0
    for (const loja of consentidas) {
      process.stdout.write(`  ${loja.url.padEnd(34)} `)
      const { hostname, resultado } = await medirConsentida(loja)
      /* O passo que decide é `read-payment`, não `reach-checkout`. Abrir a URL
         /checkout é chegar na porta; o que o lojista quer saber é se a tela de
         pagamento apareceu. Medir pelo `reach-checkout`, como esta linha fazia
         antes, dava "chegou ao checkout" mesmo quando a jornada morria na
         etapa de frete — um número mais bonito do que a verdade. */
      const chegou = resultado.steps.find((s) => s.id === 'read-payment')?.outcome.status === 'done'
      if (chegou) leuPagamento++
      console.log(
        `${resultado.status.padEnd(8)} ${chegou ? 'leu o pagamento' : 'parou antes do pagamento'} · ` +
          `${(resultado.timings.totalMs / 1000).toFixed(1)}s${resultado.errorCode ? ` · ${resultado.errorCode}` : ''}`,
      )
      /* Todos os passos, não só o último: sem isto, "parou antes" não diz ONDE
         parou, e a próxima pergunta seria sempre "mas parou aonde?". */
      const trilha = resultado.steps.map((s) => `${s.id}:${s.outcome.status}`).join(' → ')
      linha(`  passos: ${trilha}`)
      /* `errorCode` sozinho não bastava — CATALOG_UNREADABLE pode ser status
         != 200 OU corpo que não é JSON (a página de senha devolvida como
         HTML, por exemplo), e sem o detalhe não dava pra saber qual das
         duas sem rodar de novo. */
      if (resultado.errorReason) linha(`  motivo: ${resultado.errorReason}`)
      if (resultado.errorDetail) linha(`  detalhe: ${JSON.stringify(resultado.errorDetail).slice(0, 300)}`)
      void hostname
    }
    console.log('')
    console.log(`  RESUMO DA CAMADA 2: leu a tela de pagamento em ${leuPagamento} de ${consentidas.length}`)
  }
  console.log('')
}

/* Só roda sozinho quando o arquivo é o alvo direto da execução. Sem isto, um
   teste que importa `medirLeitura` pra testar contra a loja falsa dispararia
   a auditoria de 28 lojas reais — exatamente o oposto do que a §2.2 pede. */
if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? '')) {
  await main()
}
