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

/** Converte qualquer throw em AuditError, para que `errorReason` nunca seja `undefined`. */
export function toAuditError(e: unknown, fallback: AuditErrorCode = 'NETWORK_ERROR'): AuditError {
  if (isAuditError(e)) return e
  const message = e instanceof Error ? e.message : String(e)
  return new AuditError(fallback, message)
}
