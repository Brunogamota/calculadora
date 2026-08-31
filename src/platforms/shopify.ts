/**
 * Shopify — §6.2: `window.Shopify`, `cdn.shopify.com`, header `x-shopid`,
 * rota `/products.json`.
 *
 * Nenhum destes é seletor de tema: são globais da plataforma, domínio de CDN,
 * header de servidor e endpoint público documentado. É o que dá para afirmar
 * sem abrir o HTML de uma loja específica.
 *
 * A jornada (`journey`) entra no Bloco 3.
 */

import type { DetectionEvidence, DetectionProbe, PlatformAdapter, Signal } from '../types.ts'
import { gradeConfidence, scriptHostSignal, signalFromHeader, signalFromHtml } from './signals.ts'

/** Resposta mínima de /products.json que aceitamos como prova. */
export function isShopifyProductsJson(body: string): boolean {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return false
  }
  if (typeof parsed !== 'object' || parsed === null) return false
  const products = (parsed as Record<string, unknown>)['products']
  if (!Array.isArray(products)) return false
  if (products.length === 0) return true // loja vazia ainda é Shopify
  const first = products[0] as Record<string, unknown> | undefined
  return typeof first?.['handle'] === 'string' && Array.isArray(first?.['variants'])
}

export function collectShopifySignals(probe: Pick<DetectionProbe, 'html' | 'headers' | 'globals'>): Signal[] {
  const out: Signal[] = []

  if (probe.globals.shopify.present) {
    const shop = probe.globals.shopify.shop
    out.push({
      where: 'global',
      detail: shop ? `window.Shopify presente (shop: ${shop})` : 'window.Shopify presente',
      weight: 'high',
    })
  }

  const shopId = signalFromHeader(probe.headers, 'x-shopid', 'high')
  if (shopId) out.push(shopId)
  const stage = signalFromHeader(probe.headers, 'x-shopify-stage', 'high')
  if (stage) out.push(stage)

  for (const host of ['cdn.shopify.com', 'cdn.shopifycloud.com']) {
    const s = scriptHostSignal(probe.globals, host, 'medium')
    if (s) out.push(s)
  }
  const cdn = signalFromHtml(probe.html, 'cdn.shopify.com', 'medium')
  if (cdn && !out.some((s) => s.detail.includes('cdn.shopify.com'))) out.push(cdn)

  const myshopify = signalFromHtml(probe.html, 'myshopify.com', 'medium')
  if (myshopify) out.push(myshopify)

  return out
}

export const shopifyAdapter: PlatformAdapter = {
  id: 'shopify',
  label: 'Shopify',
  order: 1,

  async detect(probe: DetectionProbe): Promise<DetectionEvidence | null> {
    const signals = collectShopifySignals(probe)

    // /products.json é a prova mais forte que existe para Shopify, então vale
    // sempre a requisição — inclusive quando nenhum outro sinal apareceu, que é
    // justamente o caso em que ela decide.
    const url = new URL('/products.json?limit=1', probe.baseUrl).href
    const permission = probe.gate.check(url)
    if (!permission.allowed) {
      signals.push({
        where: 'endpoint',
        detail: '/products.json não consultado: proibido pelo robots.txt',
        weight: 'low',
      })
    } else {
      try {
        const res = await probe.fetch(url, { timeoutMs: 8000, maxBytes: 512 * 1024 })
        if (res.status === 200 && isShopifyProductsJson(res.body)) {
          signals.push({
            where: 'endpoint',
            detail: '/products.json respondeu 200 com catálogo Shopify válido',
            weight: 'high',
          })
        } else {
          // Tentativa que não confirmou também é evidência: mostra o que foi
          // testado, em vez de deixar o silêncio parecer que ninguém olhou.
          signals.push({
            where: 'endpoint',
            detail: `/products.json não confirmou (status ${res.status})`,
            weight: 'low',
          })
        }
      } catch (e) {
        signals.push({
          where: 'endpoint',
          detail: `/products.json não pôde ser consultado (${e instanceof Error ? e.message : 'erro'})`,
          weight: 'low',
        })
      }
    }

    const decisive = signals.filter((s) => s.weight !== 'low')
    if (decisive.length === 0) return null
    return { platform: 'shopify', confidence: gradeConfidence(signals), signals }
  },
}
