/**
 * safeFetch — o único caminho de saída HTTP do motor.
 *
 * Junta num lugar só tudo que a §2 exige: User-Agent identificável, 1 req/s por
 * domínio, guards de SSRF em cada hop de redirect e validação do endereço no
 * momento da conexão (o que fecha DNS rebinding — a checagem prévia sozinha não
 * fecha, porque o DNS pode responder diferente entre a checagem e o connect).
 *
 * Escrito sobre node:https em vez de fetch justamente por causa do `lookup`:
 * é o gancho que permite reprovar o endereço na hora de conectar.
 */

import dns from 'node:dns'
import http from 'node:http'
import https from 'node:https'
import zlib from 'node:zlib'
import { Readable } from 'node:stream'
import { AuditError, toAuditError } from './errors.ts'
import { classifyAddress } from './ipranges.ts'
import { assertUrlShapeIsSafe, normalizeUrl, type NormalizedUrl } from './guards.ts'
import { HostRateLimiter } from './ratelimit.ts'

export const DEFAULT_USER_AGENT =
  process.env['AUDIT_USER_AGENT'] ?? 'RebornCheckoutAudit/1.0 (+https://rebornpay.io/raio-x)'

export interface SafeFetchOptions {
  method?: 'GET' | 'HEAD'
  headers?: Record<string, string>
  timeoutMs?: number
  maxRedirects?: number
  maxBytes?: number
  /** Desliga o rate limit apenas para robots.txt, que é pré-requisito da própria política. */
  skipRateLimit?: boolean
  /**
   * Aceita corpo cortado no limite de bytes. Padrão é NÃO aceitar: devolver
   * corpo truncado em silêncio faz o JSON.parse do chamador quebrar e o erro
   * sair como "resposta inválida", culpando o site por um limite nosso.
   */
  allowTruncated?: boolean
}

export interface SafeResponse {
  /** URL final, após redirects. */
  url: string
  status: number
  headers: Record<string, string>
  body: string
  /** Cadeia de URLs percorrida, incluindo a inicial e a final. */
  chain: string[]
  timingMs: number
  truncated: boolean
}

const DEFAULTS = {
  timeoutMs: 15_000,
  maxRedirects: 5,
  maxBytes: 5 * 1024 * 1024,
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address?: string | Array<{ address: string; family: number }>,
  family?: number,
) => void

/**
 * Resolve o hostname e reprova a conexão se QUALQUER endereço cair em faixa
 * não pública. Chamado pelo agent no momento do connect.
 */
function guardedLookup(
  hostname: string,
  options: { all?: boolean; family?: number; hints?: number },
  callback: LookupCallback,
): void {
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (
    err: NodeJS.ErrnoException | null,
    addresses: Array<{ address: string; family: number }>,
  ) => {
    if (err) return callback(err)
    const list = Array.isArray(addresses) ? addresses : [addresses]
    if (list.length === 0) {
      return callback(new AuditError('DNS_FAILURE', `${hostname} não resolveu`) as NodeJS.ErrnoException)
    }
    for (const record of list) {
      const verdict = classifyAddress(record.address)
      if (!verdict.isPublic) {
        const error = new AuditError(
          'PRIVATE_ADDRESS',
          `${hostname} resolveu para ${record.address} (${verdict.blockedBy})`,
          { hostname, address: record.address, blockedBy: verdict.blockedBy },
        )
        return callback(error as unknown as NodeJS.ErrnoException)
      }
    }
    if (options.all) return callback(null, list)
    const first = list[0]
    if (!first) return callback(new AuditError('DNS_FAILURE', `${hostname} não resolveu`) as NodeJS.ErrnoException)
    return callback(null, first.address, first.family)
  })
}

function decompress(stream: Readable, encoding: string | undefined): Readable {
  switch ((encoding ?? '').toLowerCase()) {
    case 'gzip':
      return stream.pipe(zlib.createGunzip())
    case 'deflate':
      return stream.pipe(zlib.createInflate())
    case 'br':
      return stream.pipe(zlib.createBrotliDecompress())
    default:
      return stream
  }
}

function flattenHeaders(raw: http.IncomingHttpHeaders): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue
    out[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value)
  }
  return out
}

interface SingleRequestResult {
  status: number
  headers: Record<string, string>
  body: string
  truncated: boolean
}

function requestOnce(
  url: NormalizedUrl,
  options: Required<Pick<SafeFetchOptions, 'method' | 'timeoutMs' | 'maxBytes'>> & {
    headers: Record<string, string>
  },
): Promise<SingleRequestResult> {
  return new Promise((resolve, reject) => {
    const target = new URL(url.href)
    const transport = target.protocol === 'https:' ? https : http

    const req = transport.request(
      {
        protocol: target.protocol,
        hostname: target.hostname,
        port: target.port || (target.protocol === 'https:' ? 443 : 80),
        path: `${target.pathname}${target.search}`,
        method: options.method,
        headers: options.headers,
        lookup: guardedLookup as never,
        // Redirect é seguido manualmente para revalidar cada hop.
      },
      (res) => {
        const headers = flattenHeaders(res.headers)
        const status = res.statusCode ?? 0

        if (options.method === 'HEAD') {
          res.resume()
          resolve({ status, headers, body: '', truncated: false })
          return
        }

        const stream = decompress(res, headers['content-encoding'])
        const chunks: Buffer[] = []
        let size = 0
        let truncated = false

        stream.on('data', (chunk: Buffer) => {
          size += chunk.length
          if (size > options.maxBytes) {
            truncated = true
            req.destroy()
            return
          }
          chunks.push(chunk)
        })
        stream.on('error', (e) => reject(toAuditError(e)))
        stream.on('end', () => {
          resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8'), truncated })
        })
        res.on('aborted', () => {
          if (truncated) {
            resolve({ status, headers, body: Buffer.concat(chunks).toString('utf8'), truncated: true })
          }
        })
      },
    )

    req.setTimeout(options.timeoutMs, () => {
      req.destroy(new AuditError('REQUEST_TIMEOUT', `Timeout de ${options.timeoutMs}ms em ${url.href}`))
    })
    req.on('error', (e) => reject(toAuditError(e)))
    req.end()
  })
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])

/**
 * §6.1: "seguir redirect, revalidar o destino contra as mesmas regras".
 * Separado do safeFetch para poder ser testado sem rede — é aqui que um
 * redirect para 127.0.0.1, para localhost ou para file:// tem que morrer.
 */
export function resolveRedirectTarget(currentHref: string, location: string): NormalizedUrl {
  let absolute: string
  try {
    absolute = new URL(location, currentHref).href
  } catch {
    throw new AuditError('UNPARSEABLE_URL', `Location inválido: ${location}`, { location, currentHref })
  }
  const next = normalizeUrl(absolute)
  assertUrlShapeIsSafe(next)
  return next
}

export function createSafeFetch(limiter: HostRateLimiter) {
  return async function safeFetch(input: string, opts: SafeFetchOptions = {}): Promise<SafeResponse> {
    const method = opts.method ?? 'GET'
    const timeoutMs = opts.timeoutMs ?? DEFAULTS.timeoutMs
    const maxRedirects = opts.maxRedirects ?? DEFAULTS.maxRedirects
    const maxBytes = opts.maxBytes ?? DEFAULTS.maxBytes
    const startedAt = Date.now()

    let current = normalizeUrl(input)
    assertUrlShapeIsSafe(current)

    const chain: string[] = [current.href]

    for (let hop = 0; hop <= maxRedirects; hop++) {
      const headers: Record<string, string> = {
        'user-agent': DEFAULT_USER_AGENT,
        accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
        'accept-encoding': 'gzip, deflate, br',
        'accept-language': 'pt-BR,pt;q=0.9',
        ...opts.headers,
      }

      const url = current
      const exec = () => requestOnce(url, { method, timeoutMs, maxBytes, headers })
      const result = opts.skipRateLimit ? await exec() : await limiter.schedule(url.hostname, exec)

      // 429 é a loja dizendo "devagar". Insistir é o comportamento que a §2.2
      // proíbe, então vira erro tipado e a auditoria para.
      if (result.status === 429) {
        const retryAfter = result.headers['retry-after'] ?? null
        throw new AuditError(
          'RATE_LIMITED_BY_SITE',
          `a loja respondeu 429 em ${current.href}${retryAfter ? ` (Retry-After: ${retryAfter})` : ''}`,
          { url: current.href, retryAfter },
        )
      }

      const location = result.headers['location']
      if (REDIRECT_STATUSES.has(result.status) && location) {
        if (hop === maxRedirects) {
          throw new AuditError('TOO_MANY_REDIRECTS', `Mais de ${maxRedirects} redirects`, { chain })
        }
        const next = resolveRedirectTarget(current.href, location)
        current = next
        chain.push(next.href)
        continue
      }

      if (result.truncated && opts.allowTruncated !== true) {
        throw new AuditError(
          'RESPONSE_TOO_LARGE',
          `resposta de ${current.href} passou de ${maxBytes} bytes e foi cortada`,
          { url: current.href, maxBytes },
        )
      }

      return {
        url: current.href,
        status: result.status,
        headers: result.headers,
        body: result.body,
        chain,
        timingMs: Date.now() - startedAt,
        truncated: result.truncated,
      }
    }

    throw new AuditError('TOO_MANY_REDIRECTS', `Mais de ${maxRedirects} redirects`, { chain })
  }
}

export type SafeFetch = ReturnType<typeof createSafeFetch>
