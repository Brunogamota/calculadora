/**
 * WooCommerce — §6.2: `wp-content/plugins/woocommerce`. Fase 1: só identifica.
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter, Signal } from '../types.ts'
import { gradeConfidence, signalFromHtml } from './signals.ts'

export function collectWooSignals(probe: Pick<DetectionProbe, 'html' | 'headers' | 'globals'>): Signal[] {
  const out: Signal[] = []

  const plugin = signalFromHtml(probe.html, 'wp-content/plugins/woocommerce', 'high')
  if (plugin) out.push(plugin)

  if (probe.globals.woocommerce.present) {
    out.push({
      where: 'global',
      detail: 'parâmetros globais do WooCommerce presentes (woocommerce_params / wc_add_to_cart_params)',
      weight: 'high',
    })
  }

  // Classe no <body> é convenção do Woo, mas tema pode remover: vale MEDIUM.
  if (/<body[^>]*class="[^"]*\bwoocommerce\b/i.test(probe.html)) {
    out.push({ where: 'html', detail: '<body> com classe woocommerce', weight: 'medium' })
  }

  return out
}

export const woocommerceAdapter: PlatformAdapter = {
  id: 'woocommerce',
  label: 'WooCommerce',
  order: 4,

  async detect(probe: DetectionProbe): Promise<DetectionEvidence | null> {
    const signals = collectWooSignals(probe)
    if (signals.length === 0) return null
    return { platform: 'woocommerce', confidence: gradeConfidence(signals), signals }
  },
}
