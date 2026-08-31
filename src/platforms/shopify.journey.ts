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

async function readCartCount(ctx: JourneyContext): Promise<number | null> {
  const url = new URL('/cart.js', ctx.baseUrl).href
  if (!ctx.gate.check(url).allowed) return null
  try {
    const res = await ctx.fetch(url, { timeoutMs: 8000, maxBytes: 256 * 1024 })
    if (res.status !== 200) return null
    const parsed: unknown = JSON.parse(res.body)
    const count = (parsed as Record<string, unknown>)['item_count']
    return typeof count === 'number' ? count : null
  } catch {
    return null
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
      throw new AuditError('NETWORK_ERROR', `/products.json respondeu ${res.status}`, { status: res.status })
    }

    const url = res.url
    let products: ShopifyProduct[]
    try {
      products = (JSON.parse(res.body) as { products: ShopifyProduct[] }).products
    } catch {
      throw new AuditError('NETWORK_ERROR', '/products.json não devolveu JSON válido', {
        limit: usedLimit,
        bytes: res.body.length,
        primeiros120: res.body.slice(0, 120),
      })
    }
    if (!Array.isArray(products) || products.length === 0) {
      throw new AuditError('NETWORK_ERROR', 'catálogo vazio em /products.json')
    }

    const pick = pickProduct(products)
    if (!pick) {
      throw new AuditError('NETWORK_ERROR', 'nenhum produto disponível no catálogo', {
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

    // Guardado para a §6.6 poder dizer se o desconto do Pix já aparecia AQUI
    // ou só no checkout — a diferença é o achado PIX_DISCOUNT_LATE.
    ctx.scratch.set('productText', await ctx.page.textContent('body').catch(() => null))

    const countBefore = await readCartCount(ctx)

    // 1. formulário do Shopify
    let form = null
    let formSpec = null
    for (const spec of ADD_TO_CART_FORMS) {
      const candidate = ctx.page.locator(spec.selector).first()
      if ((await candidate.count()) > 0) {
        form = candidate
        formSpec = spec
        break
      }
    }
    if (!form || !formSpec) {
      throw new AuditError('NETWORK_ERROR', 'formulário de adicionar ao carrinho não encontrado na página', {
        tried: ADD_TO_CART_FORMS.map(describeSelector),
        productUrl: product.url,
      })
    }

    // 2. botão dentro dele
    let button = null
    let buttonSpec = null
    for (const spec of ADD_TO_CART_BUTTONS) {
      const candidate = form.locator(spec.selector).first()
      if ((await candidate.count()) > 0 && (await candidate.isVisible().catch(() => false))) {
        button = candidate
        buttonSpec = spec
        break
      }
    }
    if (!button || !buttonSpec) {
      throw new AuditError('NETWORK_ERROR', 'botão de comprar não encontrado dentro do formulário', {
        formMatched: describeSelector(formSpec),
        tried: ADD_TO_CART_BUTTONS.map(describeSelector),
        productUrl: product.url,
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

    // 4. deixa a UI reagir sem prender a jornada num waitFor que pode não vir
    await ctx.page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined)

    const uiPattern = await detectCartUiPattern(ctx, urlBefore)
    const cartShot = await ctx.recorder.capture(ctx.page, 'carrinho')

    // 5. confirmação por API (§6.4)
    const countAfter = await readCartCount(ctx)
    const confirmed = countBefore !== null && countAfter !== null ? countAfter > countBefore : null

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
            : { status: 'done' },
      }),
    )

    return {
      ok: confirmed !== false,
      ms: Date.now() - startedAt,
      // Carrinho não confirmado torna a leitura do padrão de UI não confiável:
      // não houve reação de carrinho para classificar.
      uiPattern: confirmed === false ? 'unknown' : uiPattern,
      cartUrl: new URL('/cart', ctx.baseUrl).href,
      itemCount: countAfter,
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
    const container = top.closest('[id],[role="dialog"]') ?? top
    const text = (container.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 300)
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
