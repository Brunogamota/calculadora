/**
 * §6.1 Normalização e validação de URL + §2.5 proteção contra SSRF.
 *
 * Duas camadas, de propósito:
 *   1. `normalizeUrl` + `assertUrlShapeIsSafe` — sintático, sem rede, testável offline.
 *   2. `resolveHostSafely` / o `lookup` de `http.ts` — resolve DNS e valida cada
 *      endereço no momento da conexão, o que fecha DNS rebinding.
 */

import { promises as dns } from 'node:dns'
import net from 'node:net'
import { AuditError } from './errors.ts'
import { classifyAddress, type AddressVerdict } from './ipranges.ts'

/** Portas aceitas. Loja real não roda em porta exótica; porta exótica é alvo interno. */
const ALLOWED_PORTS = new Set(['', '80', '443'])

/**
 * ÚNICA brecha no guard de SSRF do projeto, e ela existe só para o teste de
 * jornada contra a loja falsa em 127.0.0.1.
 *
 * Lida do ambiente a cada chamada, nunca cacheada, e desligada por padrão. Se
 * esta variável estiver ligada em produção, a proteção da §2.5 não existe —
 * por isso ela tem nome longo e explícito, e o motor avisa no resultado.
 */
export function localTargetsAllowed(): boolean {
  return process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] === '1'
}

/** Hostnames e sufixos que nunca saem para a internet pública. */
const BLOCKED_EXACT = new Set(['localhost', 'ip6-localhost', 'ip6-loopback'])
const BLOCKED_SUFFIXES = [
  '.localhost',
  '.local',
  '.internal',
  '.intranet',
  '.lan',
  '.home.arpa',
  '.arpa',
  '.onion',
  '.test',
  '.example',
  '.invalid',
]

export interface NormalizedUrl {
  /** URL canônica, com esquema, sem fragmento, sem credencial. */
  href: string
  hostname: string
  origin: string
  protocol: 'http:' | 'https:'
  /** true quando o input não trazia esquema e assumimos https. */
  schemeAssumed: boolean
}

/**
 * Aceita `loja.com.br`, `www.loja.com.br`, `http://loja.com.br/x?y=1`.
 * Não resolve DNS — é a camada sintática.
 */
export function normalizeUrl(input: string): NormalizedUrl {
  const raw = input.trim().replace(/^["'<]+|["'>]+$/g, '')
  if (!raw) throw new AuditError('EMPTY_INPUT', 'URL vazia')

  const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw)
  const schemeAssumed = !hasScheme
  const candidate = hasScheme ? raw : `https://${raw}`

  let url: URL
  try {
    url = new URL(candidate)
  } catch {
    throw new AuditError('UNPARSEABLE_URL', `URL inválida: ${input}`, { input })
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AuditError('BAD_SCHEME', `Esquema não permitido: ${url.protocol}`, {
      input,
      protocol: url.protocol,
    })
  }
  if (url.username || url.password) {
    throw new AuditError('HAS_CREDENTIALS', 'URL com credencial embutida não é aceita', { input })
  }
  if (!ALLOWED_PORTS.has(url.port) && !localTargetsAllowed()) {
    throw new AuditError('PORT_NOT_ALLOWED', `Porta não permitida: ${url.port}`, {
      input,
      port: url.port,
    })
  }

  // Ponto final no hostname (`loja.com.`) é o mesmo host, mas fura comparação de string.
  if (url.hostname.endsWith('.') && url.hostname.length > 1) {
    url.hostname = url.hostname.slice(0, -1)
  }
  url.hash = ''

  return {
    href: url.href,
    hostname: url.hostname,
    origin: url.origin,
    protocol: url.protocol,
    schemeAssumed,
  }
}

/**
 * Validação sintática de SSRF: rejeita IP literal e hostname reservado
 * antes de qualquer pacote sair. Não substitui a checagem em tempo de conexão.
 */
export function assertUrlShapeIsSafe(normalized: NormalizedUrl): void {
  const host = normalized.hostname.toLowerCase()

  if (localTargetsAllowed() && (host === '127.0.0.1' || host === 'localhost' || host === '::1')) {
    return
  }

  // `new URL` já converte 2130706433 e 0x7f.0.0.1 para forma pontuada,
  // então basta perguntar ao net se o resultado é IP.
  const bare = host.startsWith('[') && host.endsWith(']') ? host.slice(1, -1) : host
  if (net.isIP(bare) !== 0) {
    throw new AuditError('IP_LITERAL', `IP direto não é aceito: ${host}`, { hostname: host })
  }

  if (BLOCKED_EXACT.has(host)) {
    throw new AuditError('BLOCKED_HOSTNAME', `Hostname reservado: ${host}`, { hostname: host })
  }
  for (const suffix of BLOCKED_SUFFIXES) {
    if (host.endsWith(suffix)) {
      throw new AuditError('BLOCKED_HOSTNAME', `Sufixo reservado (${suffix}): ${host}`, {
        hostname: host,
        suffix,
      })
    }
  }
  if (!host.includes('.')) {
    throw new AuditError('SINGLE_LABEL_HOST', `Hostname de rótulo único é intranet: ${host}`, {
      hostname: host,
    })
  }
}

export interface ResolvedHost {
  hostname: string
  addresses: AddressVerdict[]
}

/** Resolve o host e exige que TODO endereço retornado seja público. */
export async function resolveHostSafely(hostname: string): Promise<ResolvedHost> {
  let records: Array<{ address: string }>
  try {
    records = await dns.lookup(hostname, { all: true, verbatim: true })
  } catch (e) {
    throw new AuditError('DNS_FAILURE', `Falha ao resolver ${hostname}`, {
      hostname,
      cause: e instanceof Error ? e.message : String(e),
    })
  }
  if (records.length === 0) {
    throw new AuditError('DNS_FAILURE', `${hostname} não resolveu para nenhum endereço`, { hostname })
  }

  const addresses = records.map((r) => classifyAddress(r.address))
  const blocked = addresses.find((a) => !a.isPublic)
  if (blocked && !localTargetsAllowed()) {
    throw new AuditError('PRIVATE_ADDRESS', `${hostname} resolve para faixa não pública`, {
      hostname,
      address: blocked.address,
      blockedBy: blocked.blockedBy,
    })
  }
  return { hostname, addresses }
}

/** Pipeline completo para uma URL — usado na entrada e em CADA hop de redirect. */
export async function guardUrl(input: string): Promise<{ url: NormalizedUrl; host: ResolvedHost }> {
  const url = normalizeUrl(input)
  assertUrlShapeIsSafe(url)
  const host = await resolveHostSafely(url.hostname)
  return { url, host }
}
