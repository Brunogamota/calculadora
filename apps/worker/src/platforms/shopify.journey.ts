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
import { matchBuyIntent } from '../journey/buyIntent.ts'
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
import { DISMISS_TEXT, classifyOverlay, isLikelyAuditArtifact } from '../journey/overlays.ts'
import {
  reachCheckout as reachCheckoutImpl,
  collectPayment as collectPaymentImpl,
} from './shopify.checkout.ts'
import type { AddToCartResult, JourneyContext, JourneyDriver, ProductRef } from '../types.ts'
import { idleCursor, moveCursorToElement } from '../journey/cursor.ts'

interface ShopifyVariant {
  id: number
  title: string
  available: boolean
  price: string
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
  skipped: { unavailable: number; giftCard: number; zeroPrice: number }
}

/**
 * §6.3: item disponível, barato, sem variação obrigatória complexa.
 * Ordena preferindo o que não exige escolha de variação e, dentro disso, o
 * mais barato — quanto mais simples o produto, menos a jornada mede o tema em
 * vez de medir o checkout.
 */
export function pickProduct(products: ShopifyProduct[]): ProductPick | null {
  const skipped = { unavailable: 0, giftCard: 0, zeroPrice: 0 }
  const candidates: Array<{ product: ShopifyProduct; variant: ShopifyVariant; complex: boolean; cents: number }> = []

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
    })
  }

  if (candidates.length === 0) return null
  candidates.sort((a, b) => Number(a.complex) - Number(b.complex) || a.cents - b.cents)
  const best = candidates[0]!
  return { product: best.product, variant: best.variant, skipped }
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
async function esperarCarrinhoMudar(ctx: JourneyContext, antes: number | null): Promise<CartReading> {
  const teto = Date.now() + ctx.deadline.clamp(5000)
  let ultima = await readCart(ctx)
  while (Date.now() < teto) {
    if (ultima.count !== null && ultima.count !== antes) return ultima
    await ctx.page.waitForTimeout(250)
    ultima = await readCart(ctx)
  }
  return ultima
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

  async addToCart(ctx: JourneyContext, product: ProductRef): Promise<AddToCartResult> {
    const startedAt = Date.now()

    const permission = ctx.gate.check(product.url)
    if (!permission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', 'robots.txt proíbe a página do produto', {
        path: permission.path,
      })
    }

    await ctx.navigate(product.url, ctx.deadline.clamp(30_000))
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

    const before = await readCart(ctx)

    // 1. formulário do Shopify
    //
    // `waitFor`, não `count()`: count é uma FOTO do DOM naquele instante, e a
    // navegação só espera domcontentloaded. Numa loja que leva 10s para montar,
    // o formulário às vezes ainda não existe quando a foto é tirada — foi o que
    // aconteceu na Insider Store, que encontrava o formulário nas rodadas
    // lentas e não encontrava nas rápidas. Esperar elimina a corrida.
    /* O formulário AJUDA, mas não manda.
       Ele existia como pré-requisito: sem `form[action*="/cart/add"]` a
       jornada morria aqui, com o código de "formulário não encontrado". E
       logo abaixo já havia uma busca pelo botão em TODA a página, por texto
       de intenção de compra — que nunca chegava a rodar, porque este `throw`
       vinha antes. Foi o que aconteceu na Carnan: a página tinha um botão
       "Comprar" bem visível, e a busca que o encontraria estava atrás de uma
       porta que o formulário ausente mantinha trancada.
       Tema que envia o carrinho por JavaScript, sem formulário clássico, é
       comum demais para ser tratado como loja que não dá para auditar. */
    const findTimeout = ctx.deadline.clamp(8000)
    let form = null
    let formSpec = null
    for (const spec of ADD_TO_CART_FORMS) {
      const candidate = ctx.page.locator(spec.selector).first()
      try {
        await candidate.waitFor({ state: 'attached', timeout: findTimeout })
        form = candidate
        formSpec = spec
        break
      } catch {
        continue
      }
    }

    // 2. botão dentro dele, em três estratégias, da mais específica para a mais
    //    geral. Esperando em vez de fotografar o DOM.
    /* Os três ao mesmo tempo, não um depois do outro.
       Em fila, o tema que só casa com o terceiro seletor pagava 5s + 5s antes
       de chegar nele, e o tema que não casa com nenhum pagava 15s para
       descobrir isso. Esperando os três juntos, o primeiro que aparecer ganha
       e o pior caso volta a ser 5s. A ORDEM continua valendo no empate: se
       mais de um estiver visível quando a espera resolve, vale o mais
       específico, que é o primeiro da lista. */
    let button = null
    let buttonHow: string | null = null

    if (form) {
      const candidatos = ADD_TO_CART_BUTTONS.map((spec) => ({ spec, locator: form.locator(spec.selector).first() }))
      // Uma espera só, com os três separados por vírgula: o CSS já sabe fazer
      // "qualquer um destes", e assim o teto de 5s é do conjunto inteiro.
      await form
        .locator(ADD_TO_CART_BUTTONS.map((spec) => spec.selector).join(', '))
        .first()
        .waitFor({ state: 'visible', timeout: ctx.deadline.clamp(5000) })
        .catch(() => undefined)
      for (const c of candidatos) {
        if (!(await c.locator.isVisible().catch(() => false))) continue
        button = c.locator
        buttonHow = describeSelector(c.spec)
        break
      }

      // Nenhum submit no formulário. Observado na Circulei (loja de aluguel em
      // Shopify): o botão diz "QUERO ALUGAR" e não é submit. O rótulo varia com o
      // MODELO DE NEGÓCIO — aluguel, assinatura, marketplace — e nenhum seletor
      // estrutural cobre isso.
      if (!button) {
        const achado = await findByBuyIntent(form)
        if (achado) {
          button = achado.locator
          buttonHow = `texto de intenção de compra: "${achado.label}"`
        }
      }
    }

    /* A página inteira. Serve para o tema que põe o botão ao lado do
       formulário, e também para o tema que não tem formulário nenhum. */
    if (!button) {
      const achado = await findByBuyIntent(ctx.page.locator('body'))
      if (achado) {
        button = achado.locator
        buttonHow = form
          ? `texto de intenção de compra fora do formulário: "${achado.label}"`
          : `texto de intenção de compra, sem formulário na página: "${achado.label}"`
      }
    }

    if (!button || !buttonHow) {
      const html = await saveHtml(
        ctx.outDir,
        new URL(ctx.baseUrl).hostname,
        form ? 'produto-sem-botao' : 'produto-sem-formulario',
        await ctx.page.content(),
      )
      throw new AuditError('BUY_BUTTON_NOT_FOUND', 'botão de comprar não encontrado na página', {
        formMatched: formSpec ? describeSelector(formSpec) : 'nenhum formulário de /cart/add na página',
        triedSelectors: ADD_TO_CART_BUTTONS.map(describeSelector),
        triedText: 'léxico de intenção de compra (comprar, alugar, assinar, reservar…)',
        candidatesSeen: await listClickableLabels(ctx.page),
        productUrl: product.url,
        htmlSavedTo: html,
      })
    }

    // 3. clique de verdade — a Fase 2 vai transmitir isto ao vivo
    const urlBefore = ctx.page.url()
    await button.scrollIntoViewIfNeeded().catch(() => undefined)

    // Antes de clicar: alguém está cobrindo o botão? Isso é achado, não
    // obstáculo. Modal em cima do botão de comprar custa venda, e o comprador
    // real precisa dos mesmos cliques extras que o robô.
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

    let blocker = await findBlocker(button)
    let clicks = 1

    if (blocker) {
      overlay.present = true
      overlay.identity = blocker.identity
      overlay.text = blocker.text
      overlay.kind = classifyOverlay(blocker.text ?? '')
      overlay.likelyAuditArtifact = isLikelyAuditArtifact(overlay.kind, ctx.auditedFromBrazil)

      // 1. Esc — gesto padrão, não depende de seletor nenhum.
      overlay.dismissAttempts.push('Escape')
      await ctx.page.keyboard.press('Escape').catch(() => undefined)
      await ctx.page.waitForTimeout(400)
      blocker = await findBlocker(button)

      // 2. Botão de fechar por rótulo acessível.
      if (blocker) {
        for (const spec of OVERLAY_DISMISS) {
          const closer = ctx.page.locator(spec.selector).first()
          if ((await closer.count()) === 0) continue
          if (!(await closer.isVisible().catch(() => false))) continue
          overlay.dismissAttempts.push(spec.id)
          await closer.click({ timeout: 3000 }).catch(() => undefined)
          clicks++
          await ctx.page.waitForTimeout(400)
          blocker = await findBlocker(button)
          if (!blocker) break
        }
      }

      // 3. Botão pelo TEXTO visível — é o que uma pessoa faria ao ver
      // "continuar neste site". Léxico, não seletor de tema.
      if (blocker) {
        const byText = ctx.page.getByRole('button', { name: DISMISS_TEXT }).first()
        if ((await byText.count()) > 0 && (await byText.isVisible().catch(() => false))) {
          overlay.dismissAttempts.push('texto-de-fechar')
          await byText.click({ timeout: 3000 }).catch(() => undefined)
          clicks++
          await ctx.page.waitForTimeout(400)
          blocker = await findBlocker(button)
        }
      }

      overlay.dismissed = blocker === null
      await ctx.recorder.capture(ctx.page, overlay.dismissed ? 'overlay-fechado' : 'overlay-persistente')
    }

    try {
      /* §7.2: leva o cursor ate o botao antes de clicar. O caminho ate ele e o
         que a pessoa assiste — e cada passo do trajeto repinta a tela, entao e
         tambem o que faz o screencast ter frame para mandar. Falhar em mover
         nunca impede o clique. */
      await moveCursorToElement(ctx.page, button).catch(() => false)
      await button.click({ timeout: ctx.deadline.clamp(10_000) })
    } catch (e) {
      if (!overlay.present) throw e
      // O overlay resistiu.
      //
      // `force: true` NÃO resolve: ele pula a espera de actionability, mas o
      // clique continua indo por coordenada, e quem recebe é o overlay. Foi o
      // que aconteceu na Insider Store — clicou, e o carrinho ficou vazio.
      //
      // `el.click()` no DOM dispara o handler no próprio elemento, sem teste de
      // sobreposição. Registra o dado do carrinho, e clickRequiredForce marca
      // que um comprador NÃO teria conseguido fazer isso.
      overlay.clickRequiredForce = true
      await button.evaluate((el) => (el as HTMLElement).click())
      await ctx.page.waitForTimeout(1000)
    }

    // 4. espera o CARRINHO mudar, que é o sinal que interessa
    //
    // Antes isto era `waitForLoadState('networkidle', 5000)`. Loja de verdade
    // não fica quieta nunca — pixel, chat, analytics batem a cada poucos
    // segundos — então o networkidle NUNCA acontecia e a espera cobrava os 5
    // segundos inteiros, em toda auditoria, sem esperar por nada. Perguntar ao
    // /cart.js volta em ~200ms quando a loja é rápida, e o teto continua
    // valendo para a loja que demora.
    const after = await esperarCarrinhoMudar(ctx, before.count)

    const uiPattern = await detectCartUiPattern(ctx, urlBefore)
    const cartShot = await ctx.recorder.capture(ctx.page, 'carrinho')

    // 6. A página do carrinho é a segunda fonte mais rica da §6.6, e também
    //    costuma ser permitida pelo robots. Muita loja põe cupom, selo e
    //    bandeiras aceitas aqui, antes do checkout.
    const cartUrl = new URL('/cart', ctx.baseUrl).href
    if (ctx.gate.check(cartUrl).allowed) {
      try {
        const nav = await ctx.navigate(cartUrl, ctx.deadline.clamp(20_000))
        ctx.scratch.set('observation:cart', await observePage(ctx, 'cart', nav.loadMs))
        await ctx.recorder.capture(ctx.page, 'pagina-carrinho')
      } catch {
        // Carrinho inacessível não invalida a jornada: o item já foi somado.
      }
    }
    const confirmed =
      before.count !== null && after.count !== null ? after.count > before.count : null

    ctx.recorder.step(
      makeStep({
        id: 'add-to-cart',
        label: 'adicionando ao carrinho',
        url: ctx.page.url(),
        startedAt,
        screenshot: cartShot ?? productShot,
        outcome:
          confirmed === false
            ? { status: 'failed', code: 'CART_NOT_CONFIRMED', reason: '/cart.js não registrou o item' }
            : confirmed === null
              ? { status: 'skipped', reason: `clique feito, confirmação indisponível — ${after.note}` }
              : { status: 'done' },
      }),
    )

    return {
      // `confirmed` já é boolean | null: null significa não verificável, e é
      // isso que sai. Antes virava `true`, afirmando sucesso sem saber.
      ok: confirmed,
      ms: Date.now() - startedAt,
      // Carrinho não confirmado torna a leitura do padrão de UI não confiável:
      // não houve reação de carrinho para classificar.
      uiPattern: confirmed === false ? 'unknown' : uiPattern,
      cartUrl: new URL('/cart', ctx.baseUrl).href,
      itemCount: after.count,
      cartReadNote: confirmed === null ? `antes: ${before.note} | depois: ${after.note}` : null,
      clicks,
      overlay,
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
  const clicaveis = scope.locator('button, a, [role="button"], input[type="button"]')
  const total = Math.min(await clicaveis.count(), 80)

  for (let i = 0; i < total; i++) {
    const candidato = clicaveis.nth(i)
    if (!(await candidato.isVisible().catch(() => false))) continue

    // `value` cobre <input type="button">, que não tem textContent.
    const texto =
      (await candidato.textContent().catch(() => null)) ??
      (await candidato.getAttribute('value').catch(() => null)) ??
      (await candidato.getAttribute('aria-label').catch(() => null))

    const achado = matchBuyIntent(texto)
    if (achado) return { locator: candidato, label: achado.label }
  }
  return null
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
