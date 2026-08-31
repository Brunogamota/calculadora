/**
 * Registry de plataformas. A ordem é a da §6.2 e ela decide o empate:
 * quando mais de uma plataforma casa (loja WooCommerce com botão do Shopify
 * embutido, por exemplo), vence a primeira da ordem — e as outras vão para
 * `alternatives`, para o empate ficar visível em vez de sumir.
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter } from '../types.ts'
import { shopifyAdapter } from './shopify.ts'
import { vtexAdapter } from './vtex.ts'
import { nuvemshopAdapter } from './nuvemshop.ts'
import { woocommerceAdapter } from './woocommerce.ts'
import { genericAdapter } from './generic.ts'

export const ADAPTERS: PlatformAdapter[] = [
  shopifyAdapter,
  vtexAdapter,
  nuvemshopAdapter,
  woocommerceAdapter,
  genericAdapter,
].sort((a, b) => a.order - b.order)

export function adapterFor(id: string): PlatformAdapter | undefined {
  return ADAPTERS.find((a) => a.id === id)
}

export interface PlatformDecision {
  evidence: DetectionEvidence
  /** Outras plataformas que também casaram, na ordem da §6.2. */
  alternatives: DetectionEvidence[]
  /** true quando só o fallback genérico respondeu. */
  fellBackToGeneric: boolean
  /** true quando a jornada existe para esta plataforma nesta fase. */
  journeySupported: boolean
}

export async function detectPlatform(probe: DetectionProbe): Promise<PlatformDecision> {
  const matches: DetectionEvidence[] = []

  for (const adapter of ADAPTERS) {
    if (adapter.id === 'generic') continue
    const evidence = await adapter.detect(probe)
    if (evidence) matches.push(evidence)
  }

  if (matches.length > 0) {
    const [winner, ...alternatives] = matches as [DetectionEvidence, ...DetectionEvidence[]]
    return {
      evidence: winner,
      alternatives,
      fellBackToGeneric: false,
      journeySupported: adapterFor(winner.platform)?.journey !== undefined,
    }
  }

  const generic = await genericAdapter.detect(probe)
  return {
    evidence: generic ?? { platform: 'generic', confidence: 'low', signals: [] },
    alternatives: [],
    fellBackToGeneric: true,
    journeySupported: false,
  }
}
