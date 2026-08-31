/**
 * §6.6 — coleta na tela de pagamento.
 *
 * Trabalha sobre o texto visível e sobre os hosts de script já observados.
 * Nenhum campo é preenchido nem submetido aqui: é leitura (§2.1).
 *
 * Regra que atravessa o arquivo: campo que não pôde ser lido com certeza sai
 * `null`, e `null` vira `not_applicable` na camada de checagens. Nunca `false`
 * por não ter achado — "não achei" e "não tem" são coisas diferentes.
 */

import {
  CARD_BRANDS,
  COUPON_TERMS,
  CPF_TERMS,
  INSTALLMENT_PATTERN,
  INTEREST_TERMS,
  PAYMENT_METHODS,
  SAVE_CARD_TERMS,
  TRUST_TERMS,
  findAllTerms,
  findTerm,
} from './vocabulary.ts'
import type { PaymentMethod, PaymentSnapshot } from '../types.ts'

/** Gateways reconhecíveis pelos scripts carregados (§6.8). */
const GATEWAY_HOSTS: Array<{ name: string; hosts: string[] }> = [
  { name: 'Mercado Pago', hosts: ['mercadopago.com', 'mlstatic.com'] },
  { name: 'Pagar.me', hosts: ['pagar.me', 'pagarme.com'] },
  { name: 'Stripe', hosts: ['stripe.com', 'stripe.network'] },
  { name: 'Adyen', hosts: ['adyen.com'] },
  { name: 'Cielo', hosts: ['cielo.com.br'] },
  { name: 'Getnet', hosts: ['getnet.com.br'] },
  { name: 'Braspag', hosts: ['braspag.com.br'] },
  { name: 'Yapay', hosts: ['yapay.com.br'] },
  { name: 'Appmax', hosts: ['appmax.com.br'] },
  { name: 'PagBank', hosts: ['pagseguro.com.br', 'pagbank.com.br'] },
  { name: 'Shopify Payments', hosts: ['shopifycs.com', 'deposit.shopifycs.com'] },
]

export function detectGateway(scriptHosts: string[]): string | null {
  for (const gateway of GATEWAY_HOSTS) {
    for (const host of gateway.hosts) {
      if (scriptHosts.some((h) => h === host || h.endsWith(`.${host}`))) return gateway.name
    }
  }
  return null
}

/** Meios visíveis e a ORDEM deles (§6.6): a ordem é dada pela posição no texto. */
export function extractMethods(text: string): PaymentMethod[] {
  const found: Array<{ label: string; index: number; evidence: string }> = []

  for (const method of PAYMENT_METHODS) {
    const hit = findTerm(text, method.terms)
    if (hit) found.push({ label: method.label, index: hit.index, evidence: hit.excerpt })
  }

  // Bandeira sem "cartão de crédito" escrito ainda indica cartão.
  if (!found.some((f) => f.label.startsWith('Cartão'))) {
    const brand = findTerm(text, CARD_BRANDS)
    if (brand) {
      found.push({
        label: 'Cartão de crédito',
        index: brand.index,
        evidence: `bandeira "${brand.term}": ${brand.excerpt}`,
      })
    }
  }

  return found
    .sort((a, b) => a.index - b.index)
    .map((f, i) => ({ label: f.label, position: i + 1, evidence: f.evidence }))
}

export interface InstallmentReading {
  present: boolean
  maxCount: number | null
  perInstallmentValueShown: boolean | null
  interestExplicit: boolean | null
  rawText: string | null
}

export function extractInstallments(text: string): InstallmentReading {
  const matches = [...text.matchAll(INSTALLMENT_PATTERN)]
  if (matches.length === 0) {
    // Sem menção a parcela: pode não haver, ou pode aparecer só depois de
    // escolher cartão. Não dá para afirmar — tudo null menos `present`.
    return {
      present: false,
      maxCount: null,
      perInstallmentValueShown: null,
      interestExplicit: null,
      rawText: null,
    }
  }

  const counts = matches.map((m) => Number(m[1])).filter((n) => Number.isFinite(n) && n > 1 && n <= 24)
  const withValue = matches.some((m) => m[2] !== undefined)
  const interest = findTerm(text, INTEREST_TERMS)
  const first = matches[0]

  return {
    present: true,
    maxCount: counts.length > 0 ? Math.max(...counts) : null,
    perInstallmentValueShown: withValue,
    interestExplicit: interest !== null,
    rawText: first?.[0]?.trim() ?? null,
  }
}

export interface PaymentPageInput {
  /** Texto visível da tela de pagamento. */
  text: string
  /** Hosts de script observados na página. */
  scriptHosts: string[]
  /** Texto da página de produto, para saber se o desconto do Pix já aparecia lá. */
  productText?: string | null
}

export function collectFromText(input: PaymentPageInput): PaymentSnapshot {
  const { text, scriptHosts } = input
  const methods = extractMethods(text)
  const pixHit = findTerm(text, ['pix'])

  // Desconto no Pix: só afirmamos quando "pix" e desconto aparecem perto.
  let discountHere: boolean | null = null
  if (pixHit) {
    const around = text.slice(Math.max(0, pixHit.index - 150), pixHit.index + 200).toLowerCase()
    discountHere = /desconto|%|off|economi/.test(around)
  }

  let discountEarlier: boolean | null = null
  if (input.productText != null) {
    const productPix = findTerm(input.productText, ['pix'])
    if (productPix) {
      const around = input.productText
        .slice(Math.max(0, productPix.index - 150), productPix.index + 200)
        .toLowerCase()
      discountEarlier = /desconto|%|off|economi/.test(around)
    } else {
      discountEarlier = false
    }
  }

  const trust = findAllTerms(text, TRUST_TERMS)

  return {
    methods,
    pix: {
      present: pixHit !== null,
      discountShownHere: discountHere,
      discountShownEarlier: discountEarlier,
    },
    installments: extractInstallments(text),
    couponField: findTerm(text, COUPON_TERMS) !== null,
    trustSignals: {
      present: trust.length > 0,
      evidence: trust.map((t) => t.excerpt),
    },
    saveCard: findTerm(text, SAVE_CARD_TERMS) !== null,
    cpfField: findTerm(text, CPF_TERMS) !== null,
    gateway: detectGateway(scriptHosts),
    rawTextSample: text.slice(0, 2000),
  }
}
