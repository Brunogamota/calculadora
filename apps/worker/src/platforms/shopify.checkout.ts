/**
 * Bloco 3b: do carrinho até a tela de meios de pagamento (§6.5, §6.6).
 *
 * A jornada PARA na tela onde os meios aparecem. Nunca preenche cartão, nunca
 * clica em concluir pedido — e isso está implementado como trava consultada
 * antes de cada clique e cada preenchimento (§2.1), não como comentário.
 */

import type { Locator, Page } from 'playwright'
import { AuditError } from '../lib/errors.ts'
import { makeStep } from '../lib/recorder.ts'
import { collectFromText } from '../journey/collectPayment.ts'
import { saveHtml } from '../lib/artifacts.ts'
import type { AuditIdentity } from '../lib/identity.ts'
import {
  CHECKOUT_FIELDS,
  CONTINUE_LABELS,
  FORBIDDEN_AUTOCOMPLETE,
  FORBIDDEN_BUTTON_TEXT,
  type FieldFinder,
} from './shopify.checkout.selectors.ts'
import type {
  AddToCartResult,
  CheckoutContext,
  JourneyContext,
  PaymentSnapshot,
} from '../types.ts'

export interface FieldFillLog {
  field: string
  /** Qual estratégia achou o campo: autocomplete, label, css — ou nenhuma. */
  foundBy: 'autocomplete' | 'label' | 'css' | null
  filled: boolean
  reason?: string
}

/** Acha um campo pelas três estratégias, do mais estável para o menos. */
export async function findField(
  page: Page,
  finder: FieldFinder,
): Promise<{ locator: Locator; foundBy: 'autocomplete' | 'label' | 'css' } | null> {
  if (finder.autocomplete) {
    const byAuto = page.locator(`input[autocomplete="${finder.autocomplete}"]`).first()
    if ((await byAuto.count()) > 0 && (await byAuto.isVisible().catch(() => false))) {
      return { locator: byAuto, foundBy: 'autocomplete' }
    }
  }
  if (finder.label) {
    const byLabel = page.getByLabel(finder.label).first()
    if ((await byLabel.count()) > 0 && (await byLabel.isVisible().catch(() => false))) {
      return { locator: byLabel, foundBy: 'label' }
    }
  }
  for (const css of finder.css ?? []) {
    const byCss = page.locator(css).first()
    if ((await byCss.count()) > 0 && (await byCss.isVisible().catch(() => false))) {
      return { locator: byCss, foundBy: 'css' }
    }
  }
  return null
}

/**
 * TRAVA §2.1: recusa preencher qualquer campo de cartão. Consultado antes de
 * todo fill, inclusive quando o rótulo enganar.
 */
async function assertNotCardField(locator: Locator, field: string): Promise<void> {
  const autocomplete = (await locator.getAttribute('autocomplete').catch(() => null))?.toLowerCase() ?? ''
  if (FORBIDDEN_AUTOCOMPLETE.includes(autocomplete)) {
    throw new AuditError('PAYMENT_FIELD_REFUSED', `recusado preencher campo de cartão (${field})`, {
      field,
      autocomplete,
    })
  }
  const name = (await locator.getAttribute('name').catch(() => null))?.toLowerCase() ?? ''
  if (/card.?number|cardnumber|cvv|cvc|security.?code/.test(name)) {
    throw new AuditError('PAYMENT_FIELD_REFUSED', `recusado preencher campo de cartão (${field})`, {
      field,
      name,
    })
  }
}

/** TRAVA §2.1: recusa clicar em qualquer botão que conclua pedido. */
export async function assertSafeToClick(locator: Locator): Promise<void> {
  const text = ((await locator.textContent().catch(() => '')) ?? '').trim()
  const label = (await locator.getAttribute('aria-label').catch(() => null)) ?? ''
  const combined = `${text} ${label}`
  if (FORBIDDEN_BUTTON_TEXT.test(combined)) {
    throw new AuditError('ORDER_SUBMISSION_REFUSED', `recusado clicar em "${text.slice(0, 60)}"`, {
      text: text.slice(0, 120),
    })
  }
}

async function fillField(
  page: Page,
  finder: FieldFinder,
  value: string | null,
): Promise<FieldFillLog> {
  if (value === null || value === '') {
    return { field: finder.id, foundBy: null, filled: false, reason: 'sem valor autorizado' }
  }
  const found = await findField(page, finder)
  if (!found) {
    return {
      field: finder.id,
      foundBy: null,
      filled: false,
      reason: finder.optional ? 'campo não encontrado (opcional)' : 'campo não encontrado',
    }
  }
  await assertNotCardField(found.locator, finder.id)
  await found.locator.fill(value, { timeout: 8000 })
  return { field: finder.id, foundBy: found.foundBy, filled: true }
}

export interface CheckoutRunOptions {
  identity: AuditIdentity | null
  /** Texto da página de produto, para comparar onde o desconto do Pix aparece. */
  productText: string | null
  outDir: string
}

export async function reachCheckout(
  ctx: JourneyContext,
  cart: AddToCartResult,
  options: CheckoutRunOptions,
): Promise<CheckoutContext & { fills: FieldFillLog[] }> {
  const startedAt = Date.now()
  const checkoutUrl = new URL('/checkout', ctx.baseUrl).href

  const permission = ctx.gate.check(checkoutUrl)
  if (!permission.allowed) {
    throw new AuditError('ROBOTS_DISALLOWED', 'robots.txt proíbe /checkout', { path: permission.path })
  }

  const nav = await ctx.navigate(checkoutUrl, ctx.deadline.clamp(30_000))
  const shot = await ctx.recorder.capture(ctx.page, 'checkout')
  let clicks = cart.clicks + 1
  let steps = 1

  const forcedLogin = await detectForcedLogin(ctx.page)

  const fills: FieldFillLog[] = []
  if (options.identity) {
    const id = options.identity
    const values: Array<[keyof typeof CHECKOUT_FIELDS, string | null]> = [
      ['email', id.email],
      ['firstName', id.firstName],
      ['lastName', id.lastName],
      ['cpf', id.cpf],
      ['postalCode', id.postalCode],
      ['address1', id.address1],
      ['addressNumber', id.addressNumber],
      ['city', id.city],
      ['phone', id.phone],
    ]
    for (const [key, value] of values) {
      const finder = CHECKOUT_FIELDS[key]
      if (!finder) continue
      fills.push(await fillField(ctx.page, finder, value))
    }

    // Avançar etapa, sempre passando pela trava antes de clicar.
    const advanced = await advanceStep(ctx)
    if (advanced) {
      clicks++
      steps++
      await ctx.recorder.capture(ctx.page, 'pagamento')
    }
  }

  const reachedPayment = await looksLikePaymentScreen(ctx.page)
  if (!reachedPayment) {
    // Não chegou: salva o HTML para corrigir os campos com evidência, em vez
    // de adivinhar qual seletor faltou.
    await saveHtml(options.outDir, new URL(ctx.baseUrl).hostname, 'checkout', await ctx.page.content())
  }

  ctx.recorder.step(
    makeStep({
      id: 'reach-checkout',
      label: 'indo para o checkout',
      url: nav.url,
      startedAt,
      screenshot: shot,
      outcome: { status: 'done' },
    }),
  )

  return {
    url: ctx.page.url(),
    reachedPaymentScreen: reachedPayment,
    forcedLogin,
    stepsFromProduct: steps,
    clicksFromProduct: clicks,
    loadMs: { home: null, product: null, checkout: nav.loadMs },
    allHttps: nav.url.startsWith('https:'),
    trail: [...ctx.recorder.steps],
    fills,
  }
}

/** Clica em "continuar" respeitando a trava de não concluir pedido. */
async function advanceStep(ctx: JourneyContext): Promise<boolean> {
  const button = ctx.page.getByRole('button', { name: CONTINUE_LABELS }).first()
  if ((await button.count()) === 0) return false
  if (!(await button.isVisible().catch(() => false))) return false
  await assertSafeToClick(button)
  const antes = ctx.page.url()
  await button.click({ timeout: ctx.deadline.clamp(15_000) }).catch(() => undefined)
  /* Espera a TELA mudar, não a rede calar. `networkidle` nunca acontece em
     loja com pixel e chat, então esta linha cobrava 8 segundos cheios de toda
     auditoria sem esperar por nada. O que interessa é a etapa do checkout ter
     avançado: ou o endereço muda, ou aparece o botão de continuar da etapa
     seguinte. */
  await ctx.page
    .waitForFunction((url) => window.location.href !== url, antes, {
      timeout: ctx.deadline.clamp(8000),
      polling: 200,
    })
    .catch(() => undefined)
  await ctx.page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined)
  return true
}

/** §6.5: login obrigatório antes do checkout. null quando não dá para afirmar. */
async function detectForcedLogin(page: Page): Promise<boolean | null> {
  const text = ((await page.textContent('body').catch(() => null)) ?? '').toLowerCase()
  if (!text) return null
  const asksLogin = /entre na sua conta|fa(ç|c)a login|sign in to continue|é preciso estar logado/.test(text)
  const hasGuest = /continuar como (visitante|convidado)|guest checkout|comprar sem cadastro/.test(text)
  if (asksLogin && !hasGuest) return true
  if (hasGuest) return false
  // Presença de campo de senha sem alternativa de visitante também indica parede.
  const password = await page.locator('input[type="password"]').count()
  if (password > 0 && !hasGuest) return true
  return false
}

/** A tela mostra meios de pagamento? Sem certeza, devolve false e o HTML é salvo. */
async function looksLikePaymentScreen(page: Page): Promise<boolean> {
  const text = ((await page.textContent('body').catch(() => null)) ?? '').toLowerCase()
  if (!text) return false
  const mentionsPayment = /forma de pagamento|meio de pagamento|payment method|pagamento/.test(text)
  const mentionsMethod = /cart(ã|a)o|pix|boleto|credit card/.test(text)
  return mentionsPayment && mentionsMethod
}

export async function collectPayment(
  ctx: JourneyContext,
  _checkout: CheckoutContext,
  options: CheckoutRunOptions,
  scriptHosts: string[],
): Promise<PaymentSnapshot> {
  const text = (await ctx.page.textContent('body').catch(() => null)) ?? ''
  return collectFromText({ text, scriptHosts, productText: options.productText })
}
