/**
 * VTEX — §6.2: `window.vtex`, `vtexassets.com`, `vtexcommercestable`,
 * rota `/api/catalog_system/pub/products/search`.
 *
 * Fase 1: só identifica. Sem jornada (§17 — Shopify funcionando de verdade,
 * as demais apenas identificando).
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter, Signal } from '../types.ts'
import { gradeConfidence, scriptHostSignal, signalFromHeaderPrefix, signalFromHtml } from './signals.ts'

export function isVtexCatalogResponse(body: string): boolean {
  try {
    const parsed: unknown = JSON.parse(body)
    if (!Array.isArray(parsed)) return false
    if (parsed.length === 0) return true
    const first = parsed[0] as Record<string, unknown> | undefined
    return typeof first?.['productId'] === 'string' || typeof first?.['productName'] === 'string'
  } catch {
    return false
  }
}

/**
 * Hosts de asset da VTEX. `vteximg.com.br` é o CDN legado e continua em uso:
 * foi o ÚNICO rastro de VTEX na Zee Dog, que não emite `vtexassets.com` nem
 * `window.vtex` por rodar storefront headless. Sem ele a loja caía no genérico.
 */
const VTEX_ASSET_HOSTS = ['vtexassets.com', 'vteximg.com.br']

/**
 * O subdomínio do CDN carrega o nome da conta VTEX da loja
 * (`grupooscar.vtexassets.com`, `zeedog.vteximg.com.br`). Isso é bem mais forte
 * que um match de string: é a conta da própria loja, não uma menção solta.
 */
export function extractVtexAccount(html: string): string | null {
  const match = html.match(/https?:\/\/([a-z0-9][a-z0-9-]*)\.(?:vtexassets\.com|vteximg\.com\.br)/i)
  return match?.[1]?.toLowerCase() ?? null
}

export function collectVtexSignals(probe: Pick<DetectionProbe, 'html' | 'headers' | 'globals'>): Signal[] {
  const out: Signal[] = []

  if (probe.globals.vtex.present) {
    const account = probe.globals.vtex.account
    out.push({
      where: 'global',
      detail: account ? `runtime VTEX presente (account: ${account})` : 'window.vtex presente',
      weight: 'high',
    })
  }

  const account = extractVtexAccount(probe.html)
  if (account) {
    out.push({
      where: 'html',
      detail: `assets servidos pela conta VTEX "${account}"`,
      weight: 'high',
    })
  } else {
    for (const host of VTEX_ASSET_HOSTS) {
      const s = scriptHostSignal(probe.globals, host, 'high') ?? signalFromHtml(probe.html, host, 'high')
      if (s) {
        out.push(s)
        break
      }
    }
  }

  // Domínio do checkout da VTEX: se aparece, o checkout da loja é VTEX.
  const secure = signalFromHtml(probe.html, 'secure.vtex.com', 'high')
  if (secure) out.push(secure)

  const stable = signalFromHtml(probe.html, 'vtexcommercestable', 'high')
  if (stable) out.push(stable)

  const header = signalFromHeaderPrefix(probe.headers, 'x-vtex-', 'high')
  if (header) out.push(header)

  return out
}

export const vtexAdapter: PlatformAdapter = {
  id: 'vtex',
  label: 'VTEX',
  order: 2,

  async detect(probe: DetectionProbe): Promise<DetectionEvidence | null> {
    const signals = collectVtexSignals(probe)
    if (signals.length === 0) return null

    const url = new URL('/api/catalog_system/pub/products/search?_from=0&_to=0', probe.baseUrl).href
    const permission = probe.gate.check(url)
    if (!permission.allowed) {
      // Silêncio aqui faria parecer que ninguém consultou o endpoint. O rastro
      // precisa dizer que a consulta não aconteceu, e por quê.
      signals.push({
        where: 'endpoint',
        detail: 'catalog_system não consultado: proibido pelo robots.txt',
        weight: 'low',
      })
    } else {
      try {
        const res = await probe.fetch(url, { timeoutMs: 8000, maxBytes: 512 * 1024 })
        if (res.status >= 200 && res.status < 300 && isVtexCatalogResponse(res.body)) {
          signals.push({
            where: 'endpoint',
            detail: 'catalog_system respondeu com payload VTEX válido',
            weight: 'high',
          })
        } else {
          signals.push({
            where: 'endpoint',
            detail: `catalog_system não confirmou (status ${res.status})`,
            weight: 'low',
          })
        }
      } catch (e) {
        signals.push({
          where: 'endpoint',
          detail: `catalog_system não pôde ser consultado (${e instanceof Error ? e.message : 'erro'})`,
          weight: 'low',
        })
      }
    }

    return { platform: 'vtex', confidence: gradeConfidence(signals), signals }
  },
}
