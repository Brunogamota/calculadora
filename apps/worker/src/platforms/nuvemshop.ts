/**
 * Nuvemshop / Tiendanube — §6.2: `window.LS`, `nuvemshop`, `tiendanube`.
 *
 * `window.LS` sozinho vale MEDIUM, não HIGH: `LS` é um nome curto e genérico
 * que outro site pode definir por acaso. Só vira certeza junto com a marca no
 * HTML. Fase 1: só identifica.
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter, Signal } from '../types.ts'
import { gradeConfidence, scriptHostSignal, signalFromHtml } from './signals.ts'

export function collectNuvemshopSignals(
  probe: Pick<DetectionProbe, 'html' | 'headers' | 'globals'>,
): Signal[] {
  const out: Signal[] = []

  if (probe.globals.nuvemshop.present) {
    out.push({ where: 'global', detail: 'window.LS presente', weight: 'medium' })
  }

  for (const needle of ['nuvemshop', 'tiendanube']) {
    const s = signalFromHtml(probe.html, needle, 'high')
    if (s) out.push(s)
    const host = scriptHostSignal(probe.globals, `${needle}.com`, 'high')
    if (host) out.push(host)
  }

  return out
}

export const nuvemshopAdapter: PlatformAdapter = {
  id: 'nuvemshop',
  label: 'Nuvemshop',
  order: 3,

  async detect(probe: DetectionProbe): Promise<DetectionEvidence | null> {
    const signals = collectNuvemshopSignals(probe)
    if (signals.length === 0) return null
    return { platform: 'nuvemshop', confidence: gradeConfidence(signals), signals }
  },
}
