/**
 * Registro da jornada: screenshot por etapa (§6.5) e trilha com URL, timestamp
 * e desfecho de cada passo.
 *
 * A trilha é a evidência do relatório. Etapa que não rodou aparece com o motivo
 * — `not_permitted_by_robots` não é falha da loja, e a trilha precisa deixar
 * essa diferença explícita.
 */

import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import type { Page } from 'playwright'
import type { JourneyStep, Recorder, StepOutcome } from '../types.ts'

export interface RecorderOptions {
  outDir: string
  hostname: string
  /** Desliga screenshot (útil em teste). */
  captureScreenshots?: boolean
}

export function createRecorder(options: RecorderOptions): Recorder & { dir: string } {
  const dir = path.join(options.outDir, options.hostname.replace(/[^a-z0-9.-]/gi, '_'))
  const steps: JourneyStep[] = []
  const capture = options.captureScreenshots !== false
  let index = 0

  return {
    dir,
    steps,

    async capture(page: Page, stepId: string): Promise<string | null> {
      if (!capture) return null
      index++
      const file = path.join(dir, `${String(index).padStart(2, '0')}-${stepId}.png`)
      try {
        await mkdir(dir, { recursive: true })
        await page.screenshot({ path: file, fullPage: false })
        return file
      } catch {
        // Screenshot é evidência, não pré-requisito: se falhar, a etapa segue
        // e o campo fica null em vez de derrubar a auditoria.
        return null
      }
    },

    step(step: JourneyStep): void {
      steps.push(step)
    },
  }
}

/** Açúcar para montar um passo sem repetir os campos fixos. */
export function makeStep(input: {
  id: string
  label: string
  url: string
  startedAt: number
  screenshot: string | null
  outcome: StepOutcome
}): JourneyStep {
  let httpsOk = false
  try {
    httpsOk = new URL(input.url).protocol === 'https:'
  } catch {
    httpsOk = false
  }
  return {
    id: input.id,
    label: input.label,
    url: input.url,
    at: new Date(input.startedAt).toISOString(),
    ms: Date.now() - input.startedAt,
    screenshot: input.screenshot,
    httpsOk,
    outcome: input.outcome,
  }
}
