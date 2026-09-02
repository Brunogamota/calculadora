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
  ModoAuditoria,
  PageObservation,
  PaymentSnapshot,
  ProductRef,
} from '../types.ts'

export type Severity = 'critica' | 'alta' | 'media' | 'baixa'

export type CheckStatus = 'pass' | 'fail' | 'not_applicable'

/**
 * Por que uma checagem não pôde ser feita, em família — não em prosa.
 *
 * O motivo escrito é para quem lê o relatório; a família é para o programa
 * poder dizer qual motivo DOMINOU sem tentar interpretar o próprio texto. A
 * alternativa era casar expressão regular contra a nossa própria prosa, que
 * quebra na primeira vez que alguém melhora uma frase.
 */
export type FamiliaDeCobertura =
  | 'robots'
  | 'modo-leitura'
  | 'loja-bloqueou'
  | 'jornada-parou'
  | 'fora-desta-fase'
  | 'dado-ilegivel'

/** A mesma família dita para o lojista, sem jargão nosso. */
export const FRASE_DA_FAMILIA: Record<FamiliaDeCobertura, string> = {
  robots: 'o arquivo robots.txt da loja pede que robôs não abram essas páginas',
  'modo-leitura': 'a auditoria rodou sem autorização da loja, então não abriu carrinho nem checkout',
  'loja-bloqueou': 'a loja bloqueou a auditoria antes de chegar nessas páginas',
  'jornada-parou': 'a auditoria não conseguiu chegar até essas páginas',
  'fora-desta-fase': 'essa parte ainda não é auditada nesta versão',
  'dado-ilegivel': 'a página abriu, mas o dado não estava claro o bastante para afirmar',
}

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
  /** A mesma coisa em família, para contar qual motivo dominou. Ver o tipo. */
  coverageFamily: FamiliaDeCobertura | null
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
  /**
   * Sob que modo a auditoria rodou. Entra aqui por causa do motivo, não do
   * veredito: em `leitura` o carrinho e o checkout não são abertos por decisão
   * nossa, e dizer "o robots.txt proíbe" nesse caso culparia a loja por uma
   * escolha que foi da auditoria.
   */
  modo: ModoAuditoria
}

/**
 * Motivo de cobertura quando o próprio modo já fechou a porta, antes do robots.
 *
 * Devolve null quando o modo não explica nada — aí quem explica é o robots ou
 * a jornada. A ordem importa: em `leitura` a requisição a carrinho e checkout
 * nem chega ao portão de robots, então o motivo do modo vem primeiro.
 */
export function razaoDoModo(
  input: CheckInput,
  ordem: ReadonlyArray<PageObservation['source']>,
): string | null {
  if (input.modo !== 'leitura') return null
  if (!ordem.every((f) => f === 'cart' || f === 'checkout')) return null
  return 'modo leitura: a auditoria não abre carrinho nem checkout em loja de terceiro'
}

/**
 * Em que família cai a ausência de uma fonte, na ordem em que as portas se
 * fecham: primeiro o modo (a requisição nem sai), depois o bloqueio da loja,
 * depois o robots, e só então a jornada que não chegou lá.
 *
 * A ordem é a mesma de `semFonte` em rules/payment.ts, e não por acaso: motivo
 * escrito e família contada precisam apontar para a mesma causa, senão o
 * resumo diz uma coisa e a linha da lista diz outra.
 */
/**
 * O robots explica esta ausência?
 *
 * Só em `leitura`. Em `consentido` o portão libera todo caminho proibido, com
 * o aceite registrado — então nada foi impedido por robots, e a lista de
 * caminhos proibidos que o relatório continua mostrando é registro do que a
 * loja pedia, não causa de nada. Culpar o robots ali seria devolver ao lojista
 * um motivo que não foi o motivo.
 */
export function robotsSegurou(
  input: CheckInput,
  ordem: ReadonlyArray<PageObservation['source']>,
): boolean {
  if (input.modo !== 'leitura') return false
  const caminhos: Record<PageObservation['source'], RegExp> = {
    product: /^\/products?\b/,
    cart: /^\/cart\b/,
    checkout: /^\/checkouts?\b/,
  }
  return input.robotsBlockedPaths.some((c) => ordem.some((f) => caminhos[f].test(c)))
}

export function familiaDaAusencia(
  input: CheckInput,
  ordem: ReadonlyArray<PageObservation['source']>,
): FamiliaDeCobertura {
  if (razaoDoModo(input, ordem)) return 'modo-leitura'
  if (input.blockedBySite) return 'loja-bloqueou'
  if (robotsSegurou(input, ordem)) return 'robots'
  return 'jornada-parou'
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
  return {
    status: 'pass',
    evidence,
    notApplicableReason: null,
    coverageFamily: null,
    recommendation,
    screenshot: null,
  }
}

export function fail(
  evidence: string[],
  recommendation: string,
  screenshot: string | null = null,
): ReturnType<CheckRule['evaluate']> {
  return {
    status: 'fail',
    evidence,
    notApplicableReason: null,
    coverageFamily: null,
    recommendation,
    screenshot,
  }
}

export function notApplicable(
  reason: string,
  familia: FamiliaDeCobertura = 'dado-ilegivel',
): ReturnType<CheckRule['evaluate']> {
  return {
    status: 'not_applicable',
    evidence: [],
    notApplicableReason: reason,
    coverageFamily: familia,
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
