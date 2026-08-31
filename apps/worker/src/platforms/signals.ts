/**
 * Extração de sinais: funções puras sobre (html, headers, globals).
 *
 * Separado dos adapters de propósito. É esta camada que os testes cobrem —
 * a captura no browser é mecânica, a decisão é aqui.
 */

import type { Confidence, PageGlobals, Signal } from '../types.ts'

export function signalFromHtml(html: string, needle: string, weight: Confidence): Signal | null {
  if (!html.toLowerCase().includes(needle.toLowerCase())) return null
  return { where: 'html', detail: `HTML contém "${needle}"`, weight }
}

export function signalFromHeader(
  headers: Record<string, string>,
  name: string,
  weight: Confidence,
): Signal | null {
  const value = headers[name.toLowerCase()]
  if (value === undefined) return null
  return { where: 'header', detail: `header ${name}: ${truncate(value, 80)}`, weight }
}

export function signalFromHeaderPrefix(
  headers: Record<string, string>,
  prefix: string,
  weight: Confidence,
): Signal | null {
  const hit = Object.keys(headers).find((k) => k.startsWith(prefix.toLowerCase()))
  if (!hit) return null
  return { where: 'header', detail: `header ${hit}: ${truncate(headers[hit] ?? '', 80)}`, weight }
}

export function truncate(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)}…`
}

/**
 * Nota final a partir dos sinais.
 *   high   — pelo menos um sinal forte
 *   medium — dois ou mais sinais médios
 *   low    — só um sinal médio, ou só sinais fracos
 * Sem sinal nenhum, o adapter devolve null e nem chega aqui.
 */
export function gradeConfidence(signals: Signal[]): Confidence {
  if (signals.some((s) => s.weight === 'high')) return 'high'
  const mediums = signals.filter((s) => s.weight === 'medium').length
  if (mediums >= 2) return 'medium'
  return 'low'
}

export function scriptHostSignal(globals: PageGlobals, suffix: string, weight: Confidence): Signal | null {
  const hit = globals.scriptHosts.find((h) => h === suffix || h.endsWith(`.${suffix}`))
  if (!hit) return null
  return { where: 'html', detail: `carrega asset de ${hit}`, weight }
}
