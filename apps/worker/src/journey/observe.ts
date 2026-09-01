/**
 * Observa a página atual e extrai o que a §6.6 pede, venha ela de onde vier.
 *
 * Usa `innerText`, não `textContent`: textContent inclui o conteúdo de <style>
 * e <script>, e já produziu um bloco de CSS onde deveria haver a frase visível
 * — foi o que quebrou a classificação de overlay antes.
 */

import { readPageGlobals } from '../lib/browser.ts'
import { collectFromText } from './collectPayment.ts'
import type { JourneyContext, PageObservation } from '../types.ts'

export async function observePage(
  ctx: JourneyContext,
  source: PageObservation['source'],
  loadMs: number | null = null,
): Promise<PageObservation> {
  const text = await ctx.page
    .evaluate(() => document.body?.innerText ?? '')
    .catch(() => '')
  const globals = await readPageGlobals(ctx.page).catch(() => ({ scriptHosts: [] as string[] }))

  return {
    source,
    url: ctx.page.url(),
    loadMs,
    snapshot: collectFromText({ text, scriptHosts: globals.scriptHosts }),
  }
}
