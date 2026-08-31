/**
 * Contrato de fio entre worker, realtime e web (§7.3).
 *
 * Este pacote é DE PROPÓSITO magro: só o que atravessa o processo. Os tipos
 * internos do motor — PlatformAdapter, JourneyContext, tudo que toca Playwright
 * — ficam no worker. A web não pode nem transitivamente importar Playwright.
 */

export type Severity = 'critica' | 'alta' | 'media' | 'baixa'

/** Passos da v1, na ordem da §7.3. */
export const STEP_IDS = [
  'identify',
  'open-product',
  'add-to-cart',
  'reach-checkout',
  'read-payment',
  'mobile',
  'report',
] as const

export type StepId = (typeof STEP_IDS)[number]

export const STEP_LABELS: Record<StepId, string> = {
  identify: 'identificando a loja',
  'open-product': 'abrindo um produto',
  'add-to-cart': 'adicionando ao carrinho',
  'reach-checkout': 'indo pro checkout',
  'read-payment': 'lendo os meios de pagamento',
  mobile: 'repetindo no celular',
  report: 'montando o relatório',
}

export type AuditEvent =
  | { type: 'step:start'; id: StepId; label: string; at: string }
  | { type: 'step:done'; id: StepId; detail?: string; screenshot?: string; at: string }
  | { type: 'step:fail'; id: StepId; reason: string; at: string }
  /**
   * Etapa que não rodou e NÃO é falha — robots proibiu, fase não cobre.
   * A §7.3 só previa done e fail; forçar isto em fail mostraria um X vermelho
   * para a loja que apenas respeitou o próprio robots.
   */
  | { type: 'step:skip'; id: StepId; reason: string; at: string }
  /** `seq` permite ao front saber QUE perdeu frame, não só perdê-lo. */
  | { type: 'frame'; data: string; seq: number }
  | { type: 'finding'; code: string; severity: Severity; title: string; at: string }
  | {
      type: 'complete'
      auditId: string
      score: number | null
      /** A ressalva de cobertura viaja junto: o número nunca chega sozinho. */
      caveat: string | null
    }
  /** Desafio antibot, deadline, intervalo. Sem isto a tela giraria para sempre. */
  | { type: 'aborted'; auditId: string; code: string; reason: string }

export type AuditEventType = AuditEvent['type']

/** Estado que uma reconexão recebe: passos, sim; histórico de frames, não (§7.4). */
export interface LiveState {
  auditId: string
  steps: Array<{ id: StepId; label: string; status: 'running' | 'done' | 'failed' | 'skipped'; detail?: string }>
  findings: Array<{ code: string; severity: Severity; title: string }>
  finished: boolean
  score: number | null
  caveat: string | null
}

export function isAuditEvent(value: unknown): value is AuditEvent {
  if (typeof value !== 'object' || value === null) return false
  const type = (value as { type?: unknown }).type
  return (
    type === 'step:start' ||
    type === 'step:done' ||
    type === 'step:fail' ||
    type === 'step:skip' ||
    type === 'frame' ||
    type === 'finding' ||
    type === 'complete' ||
    type === 'aborted'
  )
}
