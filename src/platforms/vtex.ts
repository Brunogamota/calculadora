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

  const assets = scriptHostSignal(probe.globals, 'vtexassets.com', 'high')
  if (assets) out.push(assets)
  else {
    const inHtml = signalFromHtml(probe.html, 'vtexassets.com', 'high')
    if (inHtml) out.push(inHtml)
  }

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
    if (probe.gate.check(url).allowed) {
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
