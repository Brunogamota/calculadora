/**
 * Storefront headless rodando por cima da plataforma de commerce.
 *
 * A distinção importa: a plataforma é quem manda no carrinho e no checkout
 * (é o que a auditoria mede), mas o storefront é quem desenha o DOM (é o que a
 * jornada tem que navegar). Uma loja VTEX com storefront deco.cx tem checkout
 * de VTEX e DOM que não é o de VTEX.
 *
 * Os hosts abaixo foram observados em HTML real de loja (2026-08-31), não
 * deduzidos: decoims.com aparece 182x na Oscar Calçados e 190x na Zee Dog.
 */

import type { PageGlobals } from '../types.ts'

export interface StorefrontHint {
  name: string
  evidence: string
}

export function detectStorefront(html: string, globals: PageGlobals): StorefrontHint | null {
  const hosts = new Set(globals.scriptHosts)
  const inHtml = (needle: string): boolean => html.toLowerCase().includes(needle)

  if (hosts.has('decoims.com') || inHtml('decoims.com') || inHtml('deco.cx')) {
    return { name: 'deco.cx', evidence: 'assets servidos por decoims.com' }
  }
  return null
}
