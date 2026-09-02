/**
 * Erros do motor. Todo erro carrega um `code` estável que vai direto para
 * `errorReason` (§14) — nada de string solta que muda de forma a cada refactor.
 */

export type AuditErrorCode =
  // entrada / normalização
  | 'EMPTY_INPUT'
  | 'UNPARSEABLE_URL'
  | 'BAD_SCHEME'
  | 'HAS_CREDENTIALS'
  | 'PORT_NOT_ALLOWED'
  | 'SINGLE_LABEL_HOST'
  // SSRF (§2.5)
  | 'IP_LITERAL'
  | 'BLOCKED_HOSTNAME'
  | 'PRIVATE_ADDRESS'
  | 'DNS_FAILURE'
  // rede
  | 'TOO_MANY_REDIRECTS'
  | 'REQUEST_TIMEOUT'
  | 'RESPONSE_TOO_LARGE'
  | 'NETWORK_ERROR'
  | 'HOME_NOT_OK'
  | 'NO_DISPLAY'
  | 'BROWSER_LAUNCH_FAILED'
  | 'IDENTITY_MISSING'
  | 'IDENTITY_INVALID'
  | 'PAYMENT_FIELD_REFUSED'
  | 'ORDER_SUBMISSION_REFUSED'
  | 'BOT_CHALLENGE'
  | 'COOLDOWN_ACTIVE'
  | 'FORCE_WITHOUT_OWNERSHIP'
  | 'RATE_LIMITED_BY_SITE'
  // a jornada não deu para seguir NESTA loja (§6.3/§6.4)
  //
  // Estes quatro eram todos 'NETWORK_ERROR', e a tela lê NETWORK_ERROR como
  // "a loja caiu". Então "não achamos o botão de comprar neste tema" chegava
  // no lojista como "perdemos a conexão com a loja no meio do checkout" — um
  // defeito nosso vestido de defeito da loja dele. Nenhum destes é queda de
  // rede, e nenhum é culpa da loja: é o nosso alcance que acabou ali.
  | 'CATALOG_UNREADABLE'
  | 'CATALOG_EMPTY'
  | 'BUY_FORM_NOT_FOUND'
  | 'BUY_BUTTON_NOT_FOUND'
  // modo e consentimento
  //
  // O modo decide se a execução tem permissão para existir, e por isso e
  // verificado antes de tudo. Nao ha padrao: sem modo declarado a auditoria
  // recusa, em vez de escolher sozinha a resposta mais permissiva.
  | 'MODE_MISSING'
  | 'CONSENT_MISSING'
  // política (§2.3, §2.6)
  | 'ROBOTS_DISALLOWED'
  | 'ROBOTS_UNAVAILABLE'
  | 'BLOCKLISTED'
  // execução
  | 'DEADLINE_EXCEEDED'

export class AuditError extends Error {
  readonly code: AuditErrorCode
  readonly detail: Record<string, unknown>

  constructor(code: AuditErrorCode, message: string, detail: Record<string, unknown> = {}) {
    super(message)
    this.name = 'AuditError'
    this.code = code
    this.detail = detail
  }
}

export function isAuditError(e: unknown): e is AuditError {
  return e instanceof AuditError
}

/* eslint-disable no-control-regex */
const ANSI = /\u001b\[[0-9;]*m/g

/**
 * O Playwright joga o call log inteiro, com código ANSI, dentro de `message`.
 * Isso ia direto para `errorReason` e deixava a saída ilegível — a §14 pede
 * motivo de falha legível, não despejo de log. O log completo continua
 * disponível em `detail.callLog`.
 */
export function summarizeError(raw: string, maxLen = 200): string {
  const clean = raw.replace(ANSI, '')
  const firstLine = clean.split('\n')[0]?.trim() ?? clean.trim()
  return firstLine.length <= maxLen ? firstLine : `${firstLine.slice(0, maxLen)}…`
}

/** Converte qualquer throw em AuditError, para que `errorReason` nunca seja `undefined`. */
export function toAuditError(e: unknown, fallback: AuditErrorCode = 'NETWORK_ERROR'): AuditError {
  if (isAuditError(e)) return e
  const raw = e instanceof Error ? e.message : String(e)
  const summary = summarizeError(raw)
  const detail: Record<string, unknown> = {}
  if (summary !== raw.replace(ANSI, '').trim()) {
    detail['callLog'] = raw.replace(ANSI, '').slice(0, 2000)
  }
  return new AuditError(fallback, summary, detail)
}
