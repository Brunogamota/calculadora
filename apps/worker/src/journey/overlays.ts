/**
 * Overlays que cobrem o botão de comprar, e a diferença crítica entre os dois
 * tipos que existem:
 *
 *   1. Overlay REAL — cookie, newsletter, promoção. O comprador brasileiro vê,
 *      e ele custa venda. Isso é achado.
 *
 *   2. Overlay de REDIRECIONAMENTO GEOGRÁFICO — "temos uma loja para a sua
 *      região". Só aparece para visitante de fora do país da loja. Se o motor
 *      roda de um datacenter fora do Brasil, ele vê essa tela e o comprador
 *      brasileiro NÃO vê.
 *
 * Reportar o segundo como defeito da loja é acusar o lojista de um problema
 * que só existe porque auditamos do lugar errado. Por isso ele é classificado
 * e marcado como provável artefato, nunca contado como achado.
 *
 * Observado em 2026-08-31 na Insider Store, auditada de um Codespaces fora do
 * Brasil: div#cozyCRModal, "We have a dedicated store to serve your region".
 */

export type OverlayKind = 'geo-redirect' | 'consent' | 'marketing' | 'unknown'

const GEO_TERMS = [
  'dedicated store',
  'your region',
  'sua região',
  'sua regiao',
  'outro país',
  'outro pais',
  'another country',
  'shop in your country',
  'change country',
  'mudar de país',
  'international store',
  'ship to',
]

const CONSENT_TERMS = ['cookie', 'privacidade', 'consentimento', 'aceitar todos', 'accept all']

const MARKETING_TERMS = ['newsletter', 'cupom', 'desconto', 'assine', 'inscreva', 'ganhe']

/** Texto de botão que fecha overlay sem sair da loja. Léxico, não seletor. */
export const DISMISS_TEXT =
  /^(fechar|close|x|×|continuar (no|neste) site|continuar comprando|ficar (aqui|no site)|stay|n(ã|a)o,? obrigad|no,? thanks|not now|agora n(ã|a)o|aceitar|accept|entendi|ok)/i

export function classifyOverlay(text: string): OverlayKind {
  const lower = text.toLowerCase()
  if (GEO_TERMS.some((t) => lower.includes(t))) return 'geo-redirect'
  if (CONSENT_TERMS.some((t) => lower.includes(t))) return 'consent'
  if (MARKETING_TERMS.some((t) => lower.includes(t))) return 'marketing'
  return 'unknown'
}

/**
 * Um overlay de geo-redirect visto de fora do país da loja quase certamente é
 * artefato do ponto de observação, não defeito da loja.
 */
export function isLikelyAuditArtifact(kind: OverlayKind, auditedFromBrazil: boolean | null): boolean {
  return kind === 'geo-redirect' && auditedFromBrazil !== true
}
