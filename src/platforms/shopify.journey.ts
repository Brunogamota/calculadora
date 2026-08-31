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
import { ADD_TO_CART_BUTTONS, ADD_TO_CART_FORMS, CART_OVERLAYS, describeSelector } from './shopify.selectors.ts'
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
  skipped: { unavailable: number; giftCard: number }
}

/**
 * §6.3: item disponível, barato, sem variação obrigatória complexa.
 * Ordena preferindo o que não exige escolha de variação e, dentro disso, o
 * mais barato — quanto mais simples o produto, menos a jornada mede o tema em
 * vez de medir o checkout.
 */
export function pickProduct(products: ShopifyProduct[]): ProductPick | null {
  const skipped = { unavailable: 0, giftCard: 0 }
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
    const url = new URL('/products.json?limit=250', ctx.baseUrl).href

    const permission = ctx.gate.check(url)
    if (!permission.allowed) {
      throw new AuditError('ROBOTS_DISALLOWED', 'robots.txt proíbe /products.json', { path: permission.path })
    }

    const res = await ctx.fetch(url, { timeoutMs: ctx.deadline.clamp(15_000), maxBytes: 4 * 1024 * 1024 })
    if (res.status !== 200) {
      throw new AuditError('NETWORK_ERROR', `/products.json respondeu ${res.status}`, { status: res.status })
    }

    let products: ShopifyProduct[]
    try {
      products = (JSON.parse(res.body) as { products: ShopifyProduct[] }).products
    } catch {
      throw new AuditError('NETWORK_ERROR', '/products.json não devolveu JSON válido')
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
    await button.click({ timeout: ctx.deadline.clamp(15_000) })
    const clicks = 1

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
      uiPattern,
      cartUrl: new URL('/cart', ctx.baseUrl).href,
      itemCount: countAfter,
      clicks,
    }
  },

  // reachCheckout e collectPayment: bloco 3b, pendente de decisão de produto.
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
