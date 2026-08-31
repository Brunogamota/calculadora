/**
 * Fallback genérico (§6.2). Nunca afirma plataforma: só diz se a página se
 * parece com uma loja e o que foi encontrado. Confiança sempre `low`.
 *
 * Os indicadores aqui são padrões neutros de HTML de e-commerce, não seletores
 * de tema de nenhuma loja específica.
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter, Signal } from '../types.ts'

const CART_PATHS = ['/cart', '/carrinho', '/checkout', '/finalizar-compra', '/basket']

export function collectGenericSignals(probe: Pick<DetectionProbe, 'html'>): Signal[] {
  const out: Signal[] = []
  const html = probe.html
  const lower = html.toLowerCase()

  for (const path of CART_PATHS) {
    if (new RegExp(`(href|action)="[^"]*${path}(/|"|\\?)`, 'i').test(html)) {
      out.push({ where: 'html', detail: `link ou form apontando para ${path}`, weight: 'low' })
      break
    }
  }

  if (/<meta[^>]+property="og:type"[^>]+content="product"/i.test(html)) {
    out.push({ where: 'html', detail: 'meta og:type = product', weight: 'low' })
  }

  if (lower.includes('"@type":"product"') || lower.includes('"@type": "product"')) {
    out.push({ where: 'html', detail: 'JSON-LD com schema.org/Product', weight: 'low' })
  }

  if (/<(button|input)[^>]*(add[-_ ]?to[-_ ]?cart|adicionar[- ]ao[- ]carrinho|comprar)/i.test(html)) {
    out.push({ where: 'html', detail: 'botão de compra/adicionar ao carrinho no HTML', weight: 'low' })
  }

  return out
}

export const genericAdapter: PlatformAdapter = {
  id: 'generic',
  label: 'Genérico (plataforma não identificada)',
  order: 99,

  async detect(probe: DetectionProbe): Promise<DetectionEvidence | null> {
    const signals = collectGenericSignals(probe)
    // Sem indicador nenhum, ainda devolvemos `generic` — a página existe, só não
    // se parece com loja. Quem decide o que fazer com isso é o orquestrador.
    return {
      platform: 'generic',
      confidence: 'low',
      signals:
        signals.length > 0
          ? signals
          : [{ where: 'html', detail: 'nenhum indicador de e-commerce reconhecido', weight: 'low' }],
    }
  },
}
