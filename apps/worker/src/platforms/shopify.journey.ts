/**
 * Jornada Shopify — bloco 3a: encontrar produto e adicionar ao carrinho.
 *
 * O que é contrato público do Shopify e portanto não é chute:
 *   /products.json   catálogo da loja
 *   /cart.js         estado do carrinho
 *   /products/:handle?variant=:id   pré-seleciona a variação sem clicar em
 *                    seletor de tema nenhum
 *
 * O único ponto que depende de DOM é o botão de comprar, e ele mora em
 * shopify.selectors.ts com a origem declarada. A trilha registra qual seletor
 * casou; se nenhum casar, a etapa falha explicando, sem fallback silencioso.
 */

import { AuditError } from '../lib/errors.ts'
import { saveHtml } from '../lib/artifacts.ts'
import { detectBotChallenge } from '../lib/challenge.ts'
import { type BuyIntentMatch, matchBuyIntent, melhorQue } from '../journey/buyIntent.ts'
import { observePage } from '../journey/observe.ts'
import { makeStep } from '../lib/recorder.ts'
import {
  ADD_TO_CART_BUTTONS,
  ADD_TO_CART_FORMS,
  CART_OVERLAYS,
  OVERLAY_DISMISS,
  describeSelector,
} from './shopify.selectors.ts'
import { readPageGlobals } from '../lib/browser.ts'
import {
  classifyOverlay,
  dispensarSobreposicao,
  isLikelyAuditArtifact,
  limparSobreposicao,
  notaDaSobreposicao,
} from '../journey/overlays.ts'
import {
  assertSafeToClick,
  reachCheckout as reachCheckoutImpl,
  collectPayment as collectPaymentImpl,
} from './shopify.checkout.ts'
import type { AddToCartResult, AddToCartVia, JourneyContext, JourneyDriver, OndeEntrou, ProductRef } from '../types.ts'
import { fold } from '../journey/vocabulary.ts'
import { idleCursor, moveCursorToElement } from '../journey/cursor.ts'

interface ShopifyVariant {
  id: number
  title: string
  available: boolean
  price: string
  /**
   * O item tem entrega física. Vem no `/products.json` público do Shopify.
   *
   * `false` marca seguro de devolução, garantia estendida, proteção de envio,
   * curso, ebook — coisas que ENTRAM no carrinho e não passam por frete.
   * Opcional porque tema ou app podem omitir, e ausência de dado não pode
   * virar veredito: sem o campo, o produto continua candidato.
   */
  requires_shipping?: boolean
}

interface ShopifyProduct {
  handle: string
  title: string
  product_type?: string
  variants: ShopifyVariant[]
  options?: Array<{ name: string; values: string[] }>
}

/** "129.90" -> 12990. Devolve null quando não dá para ler com certeza. */
export function priceToCents(raw: unknown): number | null {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.round(raw * 100)
  if (typeof raw !== 'string') return null
  const normalized = raw.trim().replace(/\s/g, '').replace(',', '.')
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return null
  return Math.round(Number(normalized) * 100)
}

/** Produto com uma variação só e sem escolha real não exige seletor de variação. */
export function requiresVariantChoice(product: ShopifyProduct): boolean {
  if (product.variants.length <= 1) return false
  const options = product.options ?? []
  const realChoices = options.filter((o) => o.values.length > 1)
  return realChoices.length > 0
}

const GIFT_CARD = /gift.?card|vale.?presente|cart(ã|a)o.?presente/i

export interface ProductPick {
  product: ShopifyProduct
  variant: ShopifyVariant
  /** Quantos produtos foram descartados e por quê — evidência, não silêncio. */
  skipped: { unavailable: number; giftCard: number; zeroPrice: number; semFrete: number }
  /**
   * A loja só tem itens sem entrega física, e a jornada usou um deles.
   *
   * Não é falha: loja de curso e de ebook é assim. Mas muda o que a auditoria
   * mede — não há etapa de frete —, e quem lê o relatório precisa saber disso.
   */
  soDigital: boolean
}

/**
 * §6.3: item disponível, barato, sem variação obrigatória complexa.
 * Ordena preferindo o que não exige escolha de variação e, dentro disso, o
 * mais barato — quanto mais simples o produto, menos a jornada mede o tema em
 * vez de medir o checkout.
 */
export function pickProduct(products: ShopifyProduct[]): ProductPick | null {
  const skipped = { unavailable: 0, giftCard: 0, zeroPrice: 0, semFrete: 0 }
  const candidates: Array<{
    product: ShopifyProduct
    variant: ShopifyVariant
    complex: boolean
    cents: number
    temFrete: boolean
  }> = []

  for (const product of products) {
    if (GIFT_CARD.test(product.title) || GIFT_CARD.test(product.product_type ?? '')) {
      // Vale-presente não tem frete e distorce a jornada de checkout.
      skipped.giftCard++
      continue
    }
    const variant = product.variants?.find((v) => v.available === true)
    if (!variant) {
      skipped.unavailable++
      continue
    }
    const cents = priceToCents(variant.price)
    // Produto de R$ 0 é item de teste que a loja esqueceu no catálogo — e
    // pedido de valor zero pode nem exibir meios de pagamento, que é
    // justamente o que a auditoria vai medir. "Mais barato" sem piso pega
    // exatamente esse lixo: aconteceu na Insider Store, com "Teste de valor 0".
    if (cents === 0) {
      skipped.zeroPrice++
      continue
    }
    candidates.push({
      product,
      variant,
      complex: requiresVariantChoice(product),
      // Preço ilegível vai para o fim da fila em vez de virar zero.
      cents: cents ?? Number.MAX_SAFE_INTEGER,
      /* Só `false` explícito conta como "não tem frete". `undefined` é dado
         ausente, e ausência de dado não exclui ninguém. */
      temFrete: variant.requires_shipping !== false,
    })
  }

  if (candidates.length === 0) return null

  /* Item sem entrega física fica FORA, pelo mesmo motivo já escrito para o
     vale-presente logo acima: distorce a jornada de checkout, porque tira a
     etapa de frete do meio — e frete é uma das coisas que a auditoria mede.
     
     Foi assim que a auditoria da allbirds escolheu "Free Returns Coverage",
     um seguro de devolução: "mais barato" elege o add-on todas as vezes, e o
     checkout que se abriu depois não representava compra nenhuma.
     
     Mas a exclusão NÃO pode ser absoluta: loja de curso e de ebook só tem
     item sem frete, e recusá-la inteira seria trocar um resultado errado por
     nenhum resultado. Quando não sobra nada com frete, a jornada segue com o
     que há e o relatório diz que aquela loja não tem etapa de frete. */
  const comFrete = candidates.filter((c) => c.temFrete)
  const soDigital = comFrete.length === 0
  const elegiveis = soDigital ? candidates : comFrete
  skipped.semFrete = soDigital ? 0 : candidates.length - comFrete.length

  elegiveis.sort((a, b) => Number(a.complex) - Number(b.complex) || a.cents - b.cents)
  const best = elegiveis[0]!
  return { product: best.product, variant: best.variant, skipped, soDigital }
}

/**
 * Estado do carrinho, lido DE DENTRO da página.
 *
 * O safeFetch roda em node:https e não tem os cookies do browser — o carrinho
 * do Shopify vive na sessão do navegador. Perguntar por fora devolve o carrinho
 * de um visitante diferente, sempre vazio. Foi o que aconteceu na Insider
 * Store: itemCount 0 mesmo com o clique correto.
 *
 * O robots continua sendo respeitado, e o rate limit também.
 */
export interface CartReading {
  count: number | null
  /** Como foi lido, ou por que não deu. Um `catch` mudo não permite diagnóstico. */
  note: string
}

/**
 * Estado do carrinho, lido DE DENTRO da página.
 *
 * O safeFetch roda em node:https e não tem os cookies do browser — o carrinho
 * do Shopify vive na sessão do navegador. Perguntar por fora devolve o carrinho
 * de um visitante diferente, sempre vazio.
 *
 * Duas vias, porque uma pode falhar por motivo que não dá para prever daqui:
 * `fetch` de dentro da página, e o APIRequestContext do Playwright, que também
 * compartilha os cookies do contexto. A via usada fica registrada.
 */
/**
 * Pergunta ao /cart.js até o número de itens mudar, ou até o teto.
 *
 * O teto é o mesmo de antes (5s), mas agora ele é o pior caso e não o caso
 * normal: a loja que responde rápido sai na primeira ou segunda pergunta.
 * Carrinho que não muda também é resposta — devolve a última leitura, e quem
 * chama decide o que fazer com ela (§6.4: nunca afirmar que entrou).
 */
async function esperarCarrinhoMudar(
  ctx: JourneyContext,
  antes: number | null,
  tetoMs = 2500,
): Promise<CartReading> {
  const teto = Date.now() + ctx.deadline.clamp(tetoMs)
  let ultima = await readCart(ctx)
  while (Date.now() < teto) {
    if (ultima.count !== null && ultima.count !== antes) return ultima
    await ctx.page.waitForTimeout(250)
    ultima = await readCart(ctx)
  }
  return ultima
}

/**
 * Caminho 1: a API da plataforma.
 *
 * `POST /cart/add.js` com o id da variante que o /products.json já devolveu.
 * É o caminho mais confiável que existe aqui, porque não depende de tema, de
 * como a loja escreve o botão, nem de o elemento existir na tela.
 *
 * Sai de DENTRO da página, com `fetch`, e não do Node: assim leva os cookies
 * e a sessão do carrinho que o navegador já tem. Pedir do lado de fora criaria
 * um carrinho que não é o que a jornada vai visitar depois.
 */
async function adicionarPorApi(
  ctx: JourneyContext,
  product: ProductRef,
): Promise<{ ok: boolean; nota: string }> {
  const id = Number(product.variantId)
  if (!Number.isFinite(id) || id <= 0) return { ok: false, nota: 'sem id de variante utilizável' }

  const alvo = new URL('/cart/add.js', ctx.baseUrl).href
  if (!ctx.gate.check(alvo).allowed) return { ok: false, nota: 'robots.txt proíbe /cart/add.js' }

  const r = await ctx
    .rateLimited(() =>
      ctx.page.evaluate(
        async ({ url, variante }: { url: string; variante: number }) => {
          try {
            const resp = await fetch(url, {
              method: 'POST',
              headers: { 'content-type': 'application/json', accept: 'application/json' },
              body: JSON.stringify({ id: variante, quantity: 1 }),
            })
            return { status: resp.status, corpo: (await resp.text()).slice(0, 300) }
          } catch (e) {
            return { status: 0, corpo: e instanceof Error ? e.message : 'fetch falhou' }
          }
        },
        { url: alvo, variante: id },
      ),
    )
    .catch((e: unknown) => ({ status: 0, corpo: e instanceof Error ? e.message : 'evaluate falhou' }))

  // O corpo vai junto mesmo no sucesso: "200" sozinho não deixa conferir
  // depois se o item que entrou é o item que a jornada escolheu.
  if (r.status === 200) return { ok: true, nota: `200 na variante ${id} — ${r.corpo.slice(0, 160)}` }
  // 422 é a resposta do Shopify para variante sem estoque ou id inválido: a
  // API respondeu certo, o produto é que não serve. Vale dizer isso, e não
  // "a API falhou".
  if (r.status === 422) return { ok: false, nota: `422: ${r.corpo.slice(0, 120)}` }
  if (r.status === 0) return { ok: false, nota: `não respondeu: ${r.corpo.slice(0, 120)}` }
  return { ok: false, nota: `HTTP ${r.status}` }
}

/**
 * Caminho 2: submeter o formulário, sem depender de achar botão nele.
 *
 * `requestSubmit()` dispara os validadores e os handlers do tema, que é o que
 * um clique faria; `submit()` puro pula tudo isso e é o plano B, porque em
 * tema que só ouve o evento o requestSubmit sem botão pode não disparar nada.
 */
async function submeterFormulario(
  ctx: JourneyContext,
  form: import('playwright').Locator,
): Promise<{ ok: boolean; nota: string }> {
  try {
    const como = await form.evaluate((el: Element) => {
      const f = el as HTMLFormElement
      if (typeof f.requestSubmit === 'function') {
        f.requestSubmit()
        return 'requestSubmit'
      }
      f.submit()
      return 'submit'
    })
    return { ok: true, nota: `enviado por ${como}` }
  } catch (e) {
    return { ok: false, nota: e instanceof Error ? e.message.slice(0, 120) : 'submit falhou' }
  }
}

/**
 * O item entrou na jornada de compra? Três formas de responder que sim.
 *
 * A pergunta era só uma — "o /cart.js conta um item a mais?" — e ela reprova a
 * loja que não tem etapa de carrinho: o botão leva direto para o checkout, o
 * carrinho nunca existe, e a jornada concluía que a compra falhou porque
 * procurava um sinal que naquela loja nunca ia aparecer.
 *
 * A ordem importa. O carrinho é a prova mais forte, porque é um número que a
 * própria plataforma dá. As outras duas são de texto, e texto pede cuidado:
 * "o produto aparece na tela" só vale se for O produto que a jornada escolheu,
 * conferido por título E por preço. Uma vitrine de recomendados na lateral do
 * checkout também mostra produto, e não é a compra.
 */
async function ondeOItemEntrou(
  ctx: JourneyContext,
  product: ProductRef,
  antes: CartReading,
  depois: CartReading,
): Promise<{ onde: OndeEntrou; prova: string } | null> {
  // 1. Carrinho: a prova mais forte, e um número, não texto.
  if (antes.count !== null && depois.count !== null && depois.count > antes.count) {
    return { onde: 'carrinho', prova: `/cart.js: ${antes.count} -> ${depois.count} item(ns)` }
  }

  const url = ctx.page.url()
  const texto = ((await ctx.page.textContent('body').catch(() => null)) ?? '').toLowerCase()
  if (texto.length === 0) return null

  const titulo = fold(product.title)
  const temTitulo = titulo.length > 3 && fold(texto).includes(titulo)
  /* Preço em centavos vira "149,00" e "149.00": a loja escreve dos dois
     jeitos. Produto sem preço conhecido não desqualifica — aí o título
     sozinho decide, e a prova diz que foi assim. */
  const reais = product.priceCents === null ? null : (product.priceCents / 100).toFixed(2)
  const temPreco = reais === null ? null : texto.includes(reais) || texto.includes(reais.replace('.', ','))
  const temProduto = temTitulo && temPreco !== false
  const comoConferi = reais === null ? 'só pelo título (produto sem preço)' : `"${product.title}" e ${reais}`

  // 2. Tela de checkout com o item presente.
  const naTelaDeCheckout =
    /\/checkouts?\//.test(url) || /\/checkout(\?|$)/.test(url) || (await looksLikeCheckout(ctx))
  if (naTelaDeCheckout && temProduto) {
    return { onde: 'checkout', prova: `checkout em ${url} com ${comoConferi} na tela` }
  }

  // 3. Resumo do pedido com o produto, mesmo sem carrinho nenhum.
  const temResumo = /resumo do pedido|resumo da compra|order summary|seu pedido/.test(texto)
  if (temResumo && temProduto) {
    return { onde: 'resumo-do-pedido', prova: `resumo do pedido com ${comoConferi}` }
  }

  return null
}

/** Sinais de tela de checkout que não dependem do endereço. */
async function looksLikeCheckout(ctx: JourneyContext): Promise<boolean> {
  const texto = ((await ctx.page.textContent('body').catch(() => null)) ?? '').toLowerCase()
  const pedePagamento = /forma de pagamento|meio de pagamento|payment method/.test(texto)
  const pedeEntrega = /endereco de entrega|endereço de entrega|dados de entrega|frete/.test(texto)
  const pedeContato = /e-mail|email/.test(texto)
  // Duas das três: uma sozinha aparece em rodapé de qualquer página.
  return [pedePagamento, pedeEntrega, pedeContato].filter(Boolean).length >= 2
}

async function readCart(ctx: JourneyContext): Promise<CartReading> {
  const url = new URL('/cart.js', ctx.baseUrl).href
  if (!ctx.gate.check(url).allowed) {
    return { count: null, note: 'não lido: robots.txt proíbe /cart.js' }
  }

  try {
    const viaPage = await ctx.rateLimited(() =>
      ctx.page.evaluate(async (target: string) => {
        try {
          const response = await fetch(target, { headers: { accept: 'application/json' } })
          if (!response.ok) return { count: null, why: `HTTP ${response.status}` }
          const data = (await response.json()) as { item_count?: unknown }
          if (typeof data.item_count !== 'number') return { count: null, why: 'sem item_count no JSON' }
          return { count: data.item_count, why: 'ok' }
        } catch (e) {
          return { count: null, why: `fetch falhou: ${e instanceof Error ? e.message : 'erro'}` }
        }
      }, url),
    )
    if (viaPage.count !== null) return { count: viaPage.count, note: 'lido via fetch na página' }

    // Segunda via: request do contexto do browser, que compartilha os cookies.
    const response = await ctx.rateLimited(() => ctx.page.context().request.get(url, { timeout: 8000 }))
    if (!response.ok()) {
      return { count: null, note: `fetch na página: ${viaPage.why}; request do contexto: HTTP ${response.status()}` }
    }
    const data = (await response.json()) as { item_count?: unknown }
    if (typeof data.item_count === 'number') {
      return { count: data.item_count, note: 'lido via request do contexto' }
    }
    return { count: null, note: `fetch na página: ${viaPage.why}; request do contexto: sem item_count` }
  } catch (e) {
    return { count: null, note: `leitura do carrinho falhou: ${e instanceof Error ? e.message : 'erro'}` }
  }
}

export const shopifyJourney: JourneyDriver = {
  async findProduct(ctx: JourneyContext): Promise<ProductRef> {
    const startedAt = Date.now()

    const permission = ctx.gate.check(new URL('/products.json', ctx.baseUrl).href)
    if (!permission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', 'robots.txt proíbe /products.json', { path: permission.path })
    }

    // Não precisamos do catálogo inteiro, só de um item barato e disponível.
    // Catálogo grande com body_html e imagens passa fácil de alguns MB — pedir
    // 250 produtos era gastar banda para jogar fora quase tudo.
    let res
    let usedLimit = 50
    try {
      res = await ctx.fetch(new URL(`/products.json?limit=${usedLimit}`, ctx.baseUrl).href, {
        timeoutMs: ctx.deadline.clamp(15_000),
        maxBytes: 8 * 1024 * 1024,
      })
    } catch (e) {
      if (!(e instanceof AuditError) || e.code !== 'RESPONSE_TOO_LARGE') throw e
      // Catálogo com produtos muito pesados: tenta de novo pedindo bem menos.
      usedLimit = 5
      res = await ctx.fetch(new URL(`/products.json?limit=${usedLimit}`, ctx.baseUrl).href, {
        timeoutMs: ctx.deadline.clamp(15_000),
        maxBytes: 8 * 1024 * 1024,
      })
    }

    if (res.status !== 200) {
      throw new AuditError('CATALOG_UNREADABLE', `/products.json respondeu ${res.status}`, { status: res.status })
    }

    const url = res.url
    let products: ShopifyProduct[]
    try {
      products = (JSON.parse(res.body) as { products: ShopifyProduct[] }).products
    } catch {
      throw new AuditError('CATALOG_UNREADABLE', '/products.json não devolveu JSON válido', {
        limit: usedLimit,
        bytes: res.body.length,
        primeiros120: res.body.slice(0, 120),
      })
    }
    if (!Array.isArray(products) || products.length === 0) {
      throw new AuditError('CATALOG_EMPTY', 'catálogo vazio em /products.json')
    }

    const pick = pickProduct(products)
    if (!pick) {
      throw new AuditError('CATALOG_EMPTY', 'nenhum produto disponível no catálogo', {
        total: products.length,
      })
    }

    /* Loja só de itens sem entrega física — curso, ebook, assinatura. Não é
       falha, é fato sobre a LOJA, e muda o que a auditoria mede: não há etapa
       de frete para percorrer nem para medir. Vai como observação, do mesmo
       jeito que "esta loja não tem etapa de carrinho". */
    if (pick.soDigital) {
      ctx.scratch.set(
        'nota:so-digital',
        'Esta loja vende só itens sem entrega física (curso, assinatura ou similar). ' +
          'A auditoria seguiu com um deles, e por isso não há etapa de frete no que foi medido.',
      )
    }

    const productUrl = new URL(
      `/products/${pick.product.handle}?variant=${pick.variant.id}`,
      ctx.baseUrl,
    ).href

    ctx.recorder.step(
      makeStep({
        id: 'find-product',
        label: 'encontrando um produto',
        url,
        startedAt,
        screenshot: null,
        outcome: { status: 'done' },
      }),
    )

    return {
      url: productUrl,
      title: pick.product.title,
      priceCents: priceToCents(pick.variant.price),
      variantId: String(pick.variant.id),
      available: true,
      source: 'products.json',
      requiresVariantChoice: requiresVariantChoice(pick.product),
    }
  },

  /* Abrir e olhar. Nada aqui toca carrinho, e é por isso que o modo `leitura`
     pode chamar: ele para exatamente no fim deste método. */
  async observeProduct(ctx: JourneyContext, product: ProductRef): Promise<{ screenshot: string | null }> {
    const permission = ctx.gate.check(product.url)
    if (!permission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', 'robots.txt proíbe a página do produto', {
        path: permission.path,
      })
    }

    await ctx.navigate(product.url, ctx.deadline.clamp(30_000))
    /* Aqui NÃO entra passagem de limpeza, e a ausência é deliberada.
       Sobreposição na página de produto é medida logo adiante, pelo bloqueio
       em cima do BOTÃO DE COMPRAR — e aquilo é achado (`BUY_BUTTON_OBSCURED`),
       não obstáculo técnico: modal em cima do botão custa venda. Fechar antes
       de medir apagava o achado. Medir primeiro, fechar depois; quem fecha é a
       rotina do `addToCart`, que já usa a mesma escada. */
    const productShot = await ctx.recorder.capture(ctx.page, 'produto')

    // Antes de procurar qualquer elemento: a loja está nos desafiando?
    // Procurar formulário numa página de desafio produz "formulário não
    // encontrado", que culpa a loja por algo que não é defeito dela.
    const challenge = detectBotChallenge(await ctx.page.content(), ctx.page.url())
    if (challenge) {
      throw new AuditError(
        'BOT_CHALLENGE',
        `a loja respondeu com desafio antibot (${challenge.vendor}) na página do produto`,
        { vendor: challenge.vendor, signals: challenge.signals, url: ctx.page.url() },
      )
    }

    // A página de produto é fonte de §6.6 por si só: meios exibidos,
    // parcelamento, desconto no Pix e selo aparecem aqui, e esta página quase
    // nunca é proibida pelo robots — ao contrário de /checkout.
    const produtoObservado = await observePage(ctx, 'product')
    ctx.scratch.set('observation:product', produtoObservado)
    ctx.scratch.set('productText', produtoObservado.snapshot.rawTextSample)

    return { screenshot: productShot }
  },

  async addToCart(ctx: JourneyContext, product: ProductRef): Promise<AddToCartResult> {
    const startedAt = Date.now()

    const { screenshot: productShot } = await this.observeProduct(ctx, product)

    const before = await readCart(ctx)

    /* COMO O ITEM ENTRA NO CARRINHO — quatro caminhos, nesta ordem.
       
       A versão anterior tinha um só: achar um botão e clicar. Toda loja que
       escrevia o botão de um jeito novo virava auditoria perdida, e o conserto
       era sempre "põe mais um rótulo na lista". Lista de rótulos não fecha:
       loja brasileira escreve "ADICIONE À SACOLA", "Colocar na cestinha",
       "EU QUERO!", e a cada cliente novo a lista fica devendo.
       
       Então o texto virou o ÚLTIMO recurso, e na frente dele entrou o que não
       depende de como a loja escreve:
       
         1. API da plataforma — POST /cart/add.js com o id da variante que o
            /products.json já nos deu. Não depende de tema, de texto, nem de
            elemento existir na tela.
         2. Formulário — submeter form[action*="/cart/add"]. Funciona em quase
            toda Shopify, inclusive com tema customizado.
         3. Atributo — name="add", submit dentro do formulário, data-testid
            com cart ou add.
         4. Texto — e por radical flexível, não por frase exata.
       
       Falhar nas quatro tem que ser raro. Quando acontece, é `partial` com o
       motivo e o HTML salvo — nunca um palpite. */

    const overlay = {
      present: false,
      identity: null as string | null,
      kind: 'unknown' as ReturnType<typeof classifyOverlay>,
      text: null as string | null,
      dismissed: false,
      dismissAttempts: [] as string[],
      clickRequiredForce: false,
      likelyAuditArtifact: false,
    }

    const urlBefore = ctx.page.url()
    const tentativas: string[] = []
    let via: AddToCartVia | null = null
    let comoAchou: string | null = null
    let clicks = 0

    /* Confirmar entre uma tentativa e a próxima evita o pior erro possível
       aqui: insistir depois de já ter dado certo e somar o item duas vezes. */
    let perguntou = false
    const entrou = async (): Promise<CartReading> => {
      perguntou = true
      return esperarCarrinhoMudar(ctx, before.count)
    }
    const confirmou = (leitura: CartReading): boolean =>
      leitura.count !== null && before.count !== null && leitura.count > before.count
    let after: CartReading = before

    // ---- 1. API da plataforma -------------------------------------------
    const porApi = await adicionarPorApi(ctx, product)
    tentativas.push(`api: ${porApi.nota}`)
    if (porApi.ok) {
      after = await entrou()
      if (confirmou(after) || after.count === null) {
        via = 'api'
        comoAchou = `POST /cart/add.js com a variante ${product.variantId}`
      }
    }

    // ---- 2. formulário ---------------------------------------------------
    /* `waitFor`, não `count()`: count é uma FOTO do DOM naquele instante, e a
       navegação só espera domcontentloaded. Numa loja que leva 10s para
       montar, o formulário às vezes ainda não existe quando a foto é tirada —
       foi o que aconteceu na Insider Store, que encontrava o formulário nas
       rodadas lentas e não nas rápidas. */
    let form: import('playwright').Locator | null = null
    let formSpec: (typeof ADD_TO_CART_FORMS)[number] | null = null
    if (!via) {
      for (const spec of ADD_TO_CART_FORMS) {
        const candidate = ctx.page.locator(spec.selector).first()
        try {
          await candidate.waitFor({ state: 'attached', timeout: ctx.deadline.clamp(8000) })
          form = candidate
          formSpec = spec
          break
        } catch {
          continue
        }
      }

      if (form) {
        const enviado = await submeterFormulario(ctx, form)
        tentativas.push(`formulario: ${enviado.nota}`)
        if (enviado.ok) {
          after = await entrou()
          if (confirmou(after) || after.count === null) {
            via = 'formulario'
            comoAchou = describeSelector(formSpec as (typeof ADD_TO_CART_FORMS)[number])
          }
        }
      } else {
        tentativas.push('formulario: nenhum form[action*="/cart/add"] na página')
      }
    }

    // ---- 3 e 4. um botão: atributo, depois texto -------------------------
    /* Procurado SEMPRE, mesmo quando a API já resolveu.
       
       Não para clicar: para OLHAR. "Tem um modal em cima do seu botão de
       comprar" é um dos achados que mais valem para o lojista, e ele só existe
       se soubermos onde o botão está. Entrando pela API sem procurar o botão,
       o achado sumiria silenciosamente da auditoria — e "não tinha modal"
       passaria a significar "não olhamos", que é a mentira que este projeto
       mais evita. Custa poucos segundos e paga um achado. */
    let button: import('playwright').Locator | null = null
    let achadoPor: AddToCartVia | null = null
    let comoAchouBotao: string | null = null
    {
      const escopo = form ?? ctx.page.locator('body')

      /* Quando um caminho anterior já resolveu, esta busca é só para OLHAR o
         overlay — e aí não vale esperar 5s por um botão que talvez nem exista.
         Quando ela É o caminho, o teto cheio continua valendo. */
      const tetoBotao = via ? 1500 : 5000
      await escopo
        .locator(ADD_TO_CART_BUTTONS.map((spec) => spec.selector).join(', '))
        .first()
        .waitFor({ state: 'visible', timeout: ctx.deadline.clamp(tetoBotao) })
        .catch(() => undefined)
      for (const spec of ADD_TO_CART_BUTTONS) {
        const candidato = escopo.locator(spec.selector).first()
        if (!(await candidato.isVisible().catch(() => false))) continue
        button = candidato
        comoAchouBotao = describeSelector(spec)
        achadoPor = 'atributo'
        break
      }
      tentativas.push(`atributo: ${button ? `achou (${comoAchouBotao})` : 'nenhum dos seletores estruturais'}`)

      // 4. texto — último recurso, radical flexível.
      if (!button) {
        const achado = (await findByBuyIntent(escopo)) ?? (await findByBuyIntent(ctx.page.locator('body')))
        if (achado) {
          button = achado.locator
          comoAchouBotao = `texto de intenção de compra: "${achado.label}"`
          achadoPor = 'texto'
        }
        tentativas.push(`texto: ${achado ? `achou "${achado.label}"` : 'nenhum rótulo com intenção de compra'}`)
      }

      // Só vira o CAMINHO quando os anteriores não resolveram.
      if (!via && button) {
        via = achadoPor
        comoAchou = comoAchouBotao
      }
    }

    if (!via) {
      const html = await saveHtml(
        ctx.outDir,
        new URL(ctx.baseUrl).hostname,
        form ? 'produto-sem-botao' : 'produto-sem-formulario',
        await ctx.page.content(),
      )
      throw new AuditError('BUY_BUTTON_NOT_FOUND', 'nenhum dos quatro caminhos colocou o item no carrinho', {
        tentativas,
        formMatched: formSpec ? describeSelector(formSpec) : 'nenhum formulário de /cart/add na página',
        triedSelectors: ADD_TO_CART_BUTTONS.map(describeSelector),
        candidatesSeen: await listClickableLabels(ctx.page),
        productUrl: product.url,
        htmlSavedTo: html,
      })
    }

    /* O overlay é observado sempre que sabemos onde o botão está, e o clique
       só acontece quando o botão É o caminho. Modal em cima do botão de
       comprar custa venda; o comprador real precisa dos mesmos cliques extras
       que o robô, e é isso que `clickRequiredForce` registra. */
    const vaiClicar = button !== null && (via === 'atributo' || via === 'texto')
    if (button) {
      await button.scrollIntoViewIfNeeded().catch(() => undefined)

      let blocker = await findBlocker(button)
      if (vaiClicar) clicks = 1

      if (blocker) {
        overlay.present = true
        overlay.identity = blocker.identity
        overlay.text = blocker.text
        overlay.kind = classifyOverlay(blocker.text ?? '')
        overlay.likelyAuditArtifact = isLikelyAuditArtifact(overlay.kind, ctx.auditedFromBrazil)

        /* A escada mora em journey/overlays.ts porque ela é a mesma usada na
           entrada da loja e no carrinho. Enquanto estava escrita aqui dentro,
           só existia para o botão de comprar — e as outras três situações que
           o lojista vê não tinham quem as fechasse. */
        const dispensa = await dispensarSobreposicao(
          ctx.page,
          async () => {
            blocker = await findBlocker(button)
            return blocker !== null
          },
          OVERLAY_DISMISS,
          assertSafeToClick,
        )
        overlay.dismissAttempts.push(...dispensa.attempts)
        clicks += dispensa.clicks
        overlay.dismissed = dispensa.dismissed
        await ctx.recorder.capture(ctx.page, overlay.dismissed ? 'overlay-fechado' : 'overlay-persistente')
      }
    }

    if (vaiClicar && button) {
      try {
        /* §7.2: leva o cursor ate o botao antes de clicar. O caminho ate ele e
           o que a pessoa assiste — e cada passo do trajeto repinta a tela,
           entao e tambem o que faz o screencast ter frame para mandar. Falhar
           em mover nunca impede o clique. */
        await moveCursorToElement(ctx.page, button).catch(() => false)
        await button.click({ timeout: ctx.deadline.clamp(10_000) })
      } catch (e) {
        if (!overlay.present) throw e
        // O overlay resistiu.
        //
        // `force: true` NÃO resolve: ele pula a espera de actionability, mas o
        // clique continua indo por coordenada, e quem recebe é o overlay. Foi
        // o que aconteceu na Insider Store — clicou, e o carrinho ficou vazio.
        //
        // `el.click()` no DOM dispara o handler no próprio elemento, sem teste
        // de sobreposição. Registra o dado do carrinho, e clickRequiredForce
        // marca que um comprador NÃO teria conseguido fazer isso.
        overlay.clickRequiredForce = true
        await button.evaluate((el) => (el as HTMLElement).click())
        await ctx.page.waitForTimeout(1000)
      }

      /* O clique pode NAVEGAR — é o que faz a loja sem etapa de carrinho, que
         manda direto para o checkout. Perguntar onde o item está enquanto o
         navegador ainda está saindo da página do produto lê a página errada, e
         a resposta sai "não entrou em lugar nenhum". */
      await ctx.page.waitForLoadState('domcontentloaded', { timeout: ctx.deadline.clamp(8000) }).catch(() => undefined)
      perguntou = false
    }

    // A confirmação final. Para os caminhos que já confirmaram acima, esta
    // leitura volta na primeira pergunta; para o clique, ela é a espera de
    // verdade.
    //
    // Isto era `waitForLoadState('networkidle', 5000)`. Loja de verdade não
    // fica quieta nunca — pixel, chat, analytics batem a cada poucos segundos
    // — então o networkidle NUNCA acontecia e a espera cobrava os 5 segundos
    // inteiros, em toda auditoria, sem esperar por nada.
    /* Só pergunta de novo se nenhum caminho chegou a perguntar. Repetir aqui
       custava mais 2,5s de espera por uma resposta que já tínhamos. */
    if (!perguntou) after = await entrou()

    /* AQUI a regra de sucesso, que era o defeito de verdade.
       
       Ela perguntava uma coisa só: o /cart.js conta um item a mais? Loja que
       manda o botão direto para o checkout não tem etapa de carrinho, o
       carrinho nunca existe para ser confirmado, e a jornada dava a compra
       como falhada — procurando um sinal que naquela loja jamais apareceria.
       Carrinho vazio não é o mesmo que compra que não começou. */
    const entrada = await ondeOItemEntrou(ctx, product, before, after)

    /* O padrão de UI (gaveta, modal, redirecionamento) é a REAÇÃO ao clique.
       Sem clique não há reação para classificar: entrar por API ou por submit
       de formulário não deixa isso observável, e chutar 'inline' seria
       inventar. */
    const uiPattern = vaiClicar ? await detectCartUiPattern(ctx, urlBefore) : 'unknown'
    const cartShot = await ctx.recorder.capture(ctx.page, 'carrinho')

    // 6. A página do carrinho é a segunda fonte mais rica da §6.6, e também
    //    costuma ser permitida pelo robots. Muita loja põe cupom, selo e
    //    bandeiras aceitas aqui, antes do checkout.
    const cartUrl = new URL('/cart', ctx.baseUrl).href
    if (ctx.gate.check(cartUrl).allowed) {
      try {
        const nav = await ctx.navigate(cartUrl, ctx.deadline.clamp(20_000))
        /* Terceiro momento: o CARRINHO. Gaveta e popup de frete grátis vivem
           aqui, e nenhum deles cobre o botão de comprar da página de produto —
           que era a única pergunta que a jornada sabia fazer. */
        const noCarrinho = await limparSobreposicao(
          ctx.page,
          OVERLAY_DISMISS,
          assertSafeToClick,
          ctx.auditedFromBrazil,
        )
        const notaCarrinho = notaDaSobreposicao(noCarrinho, 'No carrinho,')
        if (notaCarrinho) ctx.scratch.set('nota:overlay-carrinho', notaCarrinho)
        ctx.scratch.set('observation:cart', await observePage(ctx, 'cart', nav.loadMs))
        await ctx.recorder.capture(ctx.page, 'pagina-carrinho')
      } catch {
        // Carrinho inacessível não invalida a jornada: o item já foi somado.
      }
    }
    /* Entrou pelo checkout ou pelo resumo: a loja PULOU a etapa de carrinho.
       O passo não falha — ele sai como pulado pela loja, e isso é informação
       sobre ela: jornada mais curta, um toque a menos até pagar. Marcar isso
       como falha nossa esconderia um fato do lojista e ainda mentiria sobre
       de quem foi o problema. */
    const lojaSemCarrinho = entrada !== null && entrada.onde !== 'carrinho'
    const confirmed = entrada !== null ? true : after.count === null ? null : false

    ctx.recorder.step(
      makeStep({
        id: 'add-to-cart',
        label: 'adicionando ao carrinho',
        url: ctx.page.url(),
        startedAt,
        screenshot: cartShot ?? productShot,
        outcome: lojaSemCarrinho
          ? {
              status: 'skipped',
              reason:
                `esta loja não tem etapa de carrinho: o item apareceu direto ` +
                `${entrada?.onde === 'checkout' ? 'no checkout' : 'no resumo do pedido'} — ${entrada?.prova}`,
            }
          : confirmed === true
            ? { status: 'done' }
            : confirmed === null
              ? { status: 'skipped', reason: `não deu para confirmar em lugar nenhum — ${after.note}` }
              : {
                  status: 'failed',
                  code: 'CART_NOT_CONFIRMED',
                  reason: 'o item não apareceu no carrinho, nem no checkout, nem em resumo de pedido',
                },
      }),
    )

    return {
      // `confirmed` já é boolean | null: null significa não verificável, e é
      // isso que sai. Antes virava `true`, afirmando sucesso sem saber.
      ok: confirmed,
      ms: Date.now() - startedAt,
      // Carrinho não confirmado torna a leitura do padrão de UI não confiável:
      // não houve reação de carrinho para classificar. Loja sem carrinho
      // também não tem padrão de carrinho para ler — e o certo ali é
      // 'redirect', que é o que de fato aconteceu.
      uiPattern: lojaSemCarrinho ? 'redirect' : confirmed === false ? 'unknown' : uiPattern,
      cartUrl: new URL('/cart', ctx.baseUrl).href,
      itemCount: after.count,
      cartReadNote: confirmed === null ? `antes: ${before.note} | depois: ${after.note}` : null,
      clicks,
      overlay,
      via,
      viaDetalhe: comoAchou,
      viasTentadas: tentativas,
      ondeEntrou: entrada?.onde ?? null,
      provaDeEntrada: entrada?.prova ?? null,
      lojaSemCarrinho,
    }
  },

  async reachCheckout(ctx, cart) {
    return reachCheckoutImpl(ctx, cart, {
      identity: ctx.identity,
      productText: (ctx.scratch.get('productText') as string | null) ?? null,
      outDir: ctx.outDir,
    })
  },

  async collectPayment(ctx, checkout) {
    const globals = await readPageGlobals(ctx.page)
    return collectPaymentImpl(
      ctx,
      checkout,
      {
        identity: ctx.identity,
        productText: (ctx.scratch.get('productText') as string | null) ?? null,
        outDir: ctx.outDir,
      },
      globals.scriptHosts,
    )
  },
}

/**
 * Devolve a identidade de quem está cobrindo o centro do botão, ou null se o
 * caminho está livre. Usa `elementFromPoint` — medida real do que o comprador
 * acertaria com o dedo, não palpite sobre classe de tema.
 */
async function findBlocker(
  button: import('playwright').Locator,
): Promise<{ identity: string; text: string | null } | null> {
  return button.evaluate((el) => {
    const rect = el.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return null
    const top = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
    if (!top) return null
    if (top === el || el.contains(top) || top.contains(el)) return null
    const id = top.id ? `#${top.id}` : ''
    const cls =
      typeof top.className === 'string' && top.className
        ? `.${top.className.trim().split(/\s+/).join('.')}`
        : ''
    // O texto do container inteiro, porque é ele que revela o TIPO do overlay.
    //
    // innerText, NÃO textContent: textContent inclui o conteúdo de <style> e
    // <script>, e o overlay da Insider Store devolveu um bloco de CSS. Com CSS
    // no lugar da frase, a classificação deu "unknown" e o modal de geo deixou
    // de ser marcado como artefato — o oposto do que a proteção existe para
    // fazer. innerText devolve o que está renderizado e visível.
    const container = top.closest('[id],[role="dialog"]') ?? top
    const visible = (container as HTMLElement).innerText ?? ''
    const text = visible.replace(/\s+/g, ' ').trim().slice(0, 300)
    return {
      identity: `${top.tagName.toLowerCase()}${id}${cls}`.slice(0, 160),
      text: text || null,
    }
  })
}

/**
 * Drawer, modal, redirect ou inline (§6.4). Drawer x modal é decidido por
 * MEDIDA, não por classe de tema: drawer ocupa a altura toda e fica colado numa
 * borda. Quando não dá para afirmar, sai 'unknown'.
 */
async function detectCartUiPattern(
  ctx: JourneyContext,
  urlBefore: string,
): Promise<AddToCartResult['uiPattern']> {
  const urlAfter = ctx.page.url()
  if (urlAfter !== urlBefore) {
    return /\/(cart|checkout|carrinho)/i.test(urlAfter) ? 'redirect' : 'inline'
  }

  for (const spec of CART_OVERLAYS) {
    const overlay = ctx.page.locator(spec.selector).first()
    if ((await overlay.count()) === 0) continue
    if (!(await overlay.isVisible().catch(() => false))) continue

    const box = await overlay.boundingBox().catch(() => null)
    const viewport = ctx.page.viewportSize()
    if (!box || !viewport) return 'unknown'

    const fullHeight = box.height >= viewport.height * 0.85
    const narrow = box.width <= viewport.width * 0.6
    const atEdge = box.x <= 2 || box.x + box.width >= viewport.width - 2
    return fullHeight && narrow && atEdge ? 'drawer' : 'modal'
  }

  return 'inline'
}

/**
 * Procura, dentro de um escopo, o primeiro clicável cujo RÓTULO indica intenção
 * de comprar. Vale para botão que não é submit, para link estilizado de botão e
 * para div com role=button — todos existem em tema real.
 */
async function findByBuyIntent(
  scope: import('playwright').Locator,
): Promise<{ locator: import('playwright').Locator; label: string } | null> {
  const clicaveis = scope.locator('button, a, [role="button"], input[type="button"], input[type="submit"]')
  const total = Math.min(await clicaveis.count(), 80)

  /* Compara TODOS e fica com o melhor, em vez de parar no primeiro.
     Com radical solto no lugar da lista fechada, mais coisas casam — e uma
     frase perdida na página ("Você pode comprar depois") casa junto com o
     botão de verdade. Parar no primeiro entregaria quem aparecesse antes no
     DOM; comparar entrega quem tem mais cara de botão. */
  let melhor: { locator: import('playwright').Locator; label: string; match: BuyIntentMatch } | null = null

  for (let i = 0; i < total; i++) {
    const candidato = clicaveis.nth(i)
    if (!(await candidato.isVisible().catch(() => false))) continue

    // `value` cobre <input type="button">, que não tem textContent.
    const texto =
      (await candidato.textContent().catch(() => null)) ??
      (await candidato.getAttribute('value').catch(() => null)) ??
      (await candidato.getAttribute('aria-label').catch(() => null))

    const achado = matchBuyIntent(texto)
    if (!achado) continue
    if (melhor === null || melhorQue(achado, melhor.match)) {
      melhor = { locator: candidato, label: achado.label, match: achado }
    }
    // Não dá para melhorar o melhor possível: para de procurar.
    if (achado.rank === 0) break
  }
  return melhor === null ? null : { locator: melhor.locator, label: melhor.label }
}

/**
 * Rótulos dos clicáveis visíveis, para o erro dizer o que HAVIA na página.
 * Sem isso, "botão não encontrado" não permite corrigir sem abrir o HTML.
 */
async function listClickableLabels(page: import('playwright').Page): Promise<string[]> {
  try {
    return await page.evaluate(() => {
      const rotulos: string[] = []
      for (const el of document.querySelectorAll('button, a, [role="button"]')) {
        const texto = (el as HTMLElement).innerText?.replace(/\s+/g, ' ').trim() ?? ''
        if (texto && texto.length <= 60 && !rotulos.includes(texto)) rotulos.push(texto)
        if (rotulos.length >= 25) break
      }
      return rotulos
    })
  } catch {
    return []
  }
}
