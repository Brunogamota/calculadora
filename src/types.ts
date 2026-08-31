/**
 * Tipos centrais do motor. Na Fase 3 isto vira /packages/types (§15).
 *
 * Regra que atravessa o arquivo inteiro: todo campo que pode não ser
 * determinável é `T | null`, nunca `T`. `null` propaga para `not_applicable`
 * na camada de checagens (§8). Campo sem `null` é campo onde o motor seria
 * obrigado a chutar — e chute é o que o princípio nº 1 proíbe.
 */

import type { Page } from 'playwright'
import type { SafeFetch } from './lib/http.ts'

// ---------------------------------------------------------------- plataformas

export type PlatformId = 'shopify' | 'vtex' | 'nuvemshop' | 'woocommerce' | 'generic'

export type Confidence = 'high' | 'medium' | 'low'

/** Globais lidos da página, capturados uma vez e reusados por todos os adapters. */
export interface PageGlobals {
  shopify: { present: boolean; shop: string | null; theme: string | null }
  vtex: { present: boolean; account: string | null }
  nuvemshop: { present: boolean }
  woocommerce: { present: boolean }
  /** Domínios de terceiros carregados na página — base para gateway (§6.8). */
  scriptHosts: string[]
}

export interface DetectionProbe {
  page: Page
  /** HTML já renderizado (page.content()), não o HTML cru do servidor. */
  html: string
  /** Headers da resposta principal, chaves em minúsculo. */
  headers: Record<string, string>
  /** Origin final, após redirects revalidados. */
  baseUrl: string
  globals: PageGlobals
  /** fetch com UA, guards de SSRF, rate limit e robots já aplicados. */
  fetch: SafeFetch
  /** Portão de robots (§2.3) com a exceção de titularidade. */
  gate: RobotsGate
}

/** Um sinal isolado que apontou para uma plataforma. Vira evidência no relatório. */
export interface Signal {
  /** Onde o sinal foi visto: 'global' | 'header' | 'html' | 'endpoint' */
  where: 'global' | 'header' | 'html' | 'endpoint'
  /** Descrição legível, com o valor real observado quando houver. */
  detail: string
  weight: Confidence
}

export interface DetectionEvidence {
  platform: PlatformId
  confidence: Confidence
  signals: Signal[]
}

export interface PlatformAdapter {
  readonly id: PlatformId
  readonly label: string
  /** Ordem da §6.2. Menor roda primeiro. */
  readonly order: number
  detect(probe: DetectionProbe): Promise<DetectionEvidence | null>
  /** Ausente = o adapter só identifica a plataforma, não percorre a jornada. */
  readonly journey?: JourneyDriver
}

// ------------------------------------------------------------------- jornada

export interface JourneyContext {
  page: Page
  baseUrl: string
  fetch: SafeFetch
  gate: RobotsGate
  recorder: Recorder
  deadline: import('./lib/deadline.ts').Deadline
}

export interface ProductRef {
  url: string
  title: string
  /** Em centavos. null quando o preço não pôde ser lido com certeza. */
  priceCents: number | null
  variantId: string | null
  available: boolean
  source: 'products.json' | 'home-link' | 'collection'
  requiresVariantChoice: boolean
}

export interface AddToCartResult {
  ok: boolean
  ms: number
  uiPattern: 'drawer' | 'modal' | 'redirect' | 'inline' | 'unknown'
  cartUrl: string
  /** Confirmado por API quando disponível (§6.4); null quando não deu para confirmar. */
  itemCount: number | null
  clicks: number
}

export interface JourneyStep {
  id: string
  label: string
  url: string
  at: string
  ms: number
  screenshot: string | null
  httpsOk: boolean
  outcome: StepOutcome
}

export type StepOutcome =
  | { status: 'done' }
  | { status: 'skipped'; reason: string }
  /** robots proibiu e não houve titularidade confirmada. Não é falha da loja. */
  | { status: 'not_permitted_by_robots'; path: string }
  | { status: 'failed'; code: string; reason: string }

export interface CheckoutContext {
  url: string
  reachedPaymentScreen: boolean
  forcedLogin: boolean | null
  stepsFromProduct: number
  clicksFromProduct: number
  loadMs: { home: number | null; product: number | null; checkout: number | null }
  allHttps: boolean
  trail: JourneyStep[]
}

export interface PaymentMethod {
  label: string
  /** Posição visual, 1-based. */
  position: number
  evidence: string
}

export interface PaymentSnapshot {
  methods: PaymentMethod[]
  pix: {
    present: boolean
    discountShownHere: boolean | null
    discountShownEarlier: boolean | null
  }
  installments: {
    present: boolean
    maxCount: number | null
    perInstallmentValueShown: boolean | null
    interestExplicit: boolean | null
    rawText: string | null
  }
  couponField: boolean | null
  trustSignals: { present: boolean | null; evidence: string[] }
  saveCard: boolean | null
  /** Só observação de campo. Nada é submetido (§2.1). */
  cpfField: boolean | null
  gateway: string | null
  rawTextSample: string
}

export interface JourneyDriver {
  findProduct(ctx: JourneyContext): Promise<ProductRef>
  addToCart(ctx: JourneyContext, product: ProductRef): Promise<AddToCartResult>
  reachCheckout(ctx: JourneyContext, cart: AddToCartResult): Promise<CheckoutContext>
  collectPayment(ctx: JourneyContext, checkout: CheckoutContext): Promise<PaymentSnapshot>
}

// -------------------------------------------------------------- infraestrutura

/** Portão de robots com a exceção de titularidade. Ver lib/gate.ts. */
export interface RobotsGate {
  readonly ownerVerified: boolean
  check(url: string): StepPermission
  /** Overrides efetivamente usados, para o relatório mostrar. */
  readonly overrides: ReadonlyArray<{ path: string; at: string }>
}

export type StepPermission =
  | { allowed: true; reason: 'robots-allowed' }
  | { allowed: true; reason: 'owner-verified-override'; path: string }
  | { allowed: false; reason: 'robots-disallowed'; path: string }

export interface Recorder {
  /** Salva screenshot e devolve o caminho relativo, ou null se não foi possível. */
  capture(page: Page, stepId: string): Promise<string | null>
  step(step: JourneyStep): void
  readonly steps: ReadonlyArray<JourneyStep>
}
