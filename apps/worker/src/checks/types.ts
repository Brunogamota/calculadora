/**
 * §8 — cada checagem tem id, severidade, evidência e recomendação.
 *
 * A regra que decide tudo aqui: `not_applicable` NÃO é meio-termo entre passar
 * e falhar. É a resposta correta quando a checagem não pôde ser feita com
 * certeza, e ela sai do denominador em vez de virar penalidade. Uma loja não
 * pode perder nota porque o robots proibiu o checkout, ou porque o dado não
 * pôde ser lido.
 */

import type {
  AddToCartResult,
  CheckoutContext,
  JourneyStep,
  PageObservation,
  PaymentSnapshot,
  ProductRef,
} from '../types.ts'

export type Severity = 'critica' | 'alta' | 'media' | 'baixa'

export type CheckStatus = 'pass' | 'fail' | 'not_applicable'

/**
 * Pesos por severidade. O documento define a escala mas não os números, então
 * estes são escolha nossa — e como a nota é normalizada pelos aplicáveis, o que
 * importa é a proporção entre eles, não o valor absoluto.
 */
export const SEVERITY_WEIGHT: Record<Severity, number> = {
  critica: 30,
  alta: 15,
  media: 8,
  baixa: 4,
}

export interface CheckResult {
  id: string
  title: string
  severity: Severity
  status: CheckStatus
  /** O que foi observado. Achado sem evidência não vai para o relatório. */
  evidence: string[]
  /** Por que não foi aplicável. Obrigatório quando status é not_applicable. */
  notApplicableReason: string | null
  recommendation: string
  screenshot: string | null
}

export interface CheckInput {
  product: ProductRef | null
  cart: AddToCartResult | null
  checkout: CheckoutContext | null
  payment: PaymentSnapshot | null
  steps: ReadonlyArray<JourneyStep>
  /** Texto da página de produto, para checagens que comparam produto vs checkout. */
  productText: string | null
  /**
   * Páginas observadas na jornada. Olhar só a tela de pagamento jogava fora a
   * maior parte do que dava para medir: /checkout quase sempre é proibido pelo
   * robots, e produto e carrinho quase nunca são.
   */
  observations: ReadonlyArray<PageObservation>
  homeLoadMs: number | null
  /** §6.7 — ausente na Fase 1, e é isso que torna MOBILE_PARITY não aplicável. */
  mobile: { steps: number; methods: number } | null
  auditedFromBrazil: boolean | null
  /** Caminhos que o robots proibiu, para distinguir "não medi" de "está errado". */
  robotsBlockedPaths: ReadonlyArray<string>
  /** Motor parou por desafio antibot, WAF ou similar. */
  blockedBySite: boolean
}

export interface CheckRule {
  id: string
  title: string
  severity: Severity
  /** Fora da tabela da §8. Marcado para poder ser vetado sem procurar. */
  beyondSpec?: boolean
  evaluate(input: CheckInput): Omit<CheckResult, 'id' | 'title' | 'severity'>
}

/** Açúcar para as regras não repetirem a forma do retorno. */
export function pass(evidence: string[], recommendation = ''): ReturnType<CheckRule['evaluate']> {
  return { status: 'pass', evidence, notApplicableReason: null, recommendation, screenshot: null }
}

export function fail(
  evidence: string[],
  recommendation: string,
  screenshot: string | null = null,
): ReturnType<CheckRule['evaluate']> {
  return { status: 'fail', evidence, notApplicableReason: null, recommendation, screenshot }
}

export function notApplicable(reason: string): ReturnType<CheckRule['evaluate']> {
  return {
    status: 'not_applicable',
    evidence: [],
    notApplicableReason: reason,
    recommendation: '',
    screenshot: null,
  }
}

/**
 * A melhor fonte disponível para uma checagem, na ordem informada.
 *
 * Cada checagem declara de onde faz sentido medi-la: cupom no carrinho ou no
 * checkout, parcelamento na página de produto (que é onde o comprador decide),
 * salvar cartão só no checkout. Medir no lugar errado distorce o que a §8 quer
 * dizer.
 */
export function melhorFonte(
  input: CheckInput,
  ordem: ReadonlyArray<PageObservation['source']>,
): PageObservation | null {
  for (const fonte of ordem) {
    const achada = input.observations.find((o) => o.source === fonte)
    if (achada) return achada
  }
  return null
}

/**
 * A tela de pagamento vista como observação.
 *
 * `payment` e `observations` descrevem a mesma coisa por dois caminhos, e dois
 * caminhos que podem divergir acabam divergindo. Derivar sempre daqui garante
 * que uma checagem nunca veja um checkout que o relatório não mostra.
 */
export function observacaoDoCheckout(
  payment: PaymentSnapshot | null,
  checkout: CheckoutContext | null,
): PageObservation | null {
  if (!payment || !checkout) return null
  return {
    source: 'checkout',
    url: checkout.url,
    loadMs: checkout.loadMs.checkout,
    snapshot: payment,
  }
}

/** Rótulo legível da fonte, para a evidência dizer onde foi medido. */
export const NOME_DA_FONTE: Record<PageObservation['source'], string> = {
  product: 'página do produto',
  cart: 'página do carrinho',
  checkout: 'tela de pagamento',
}
