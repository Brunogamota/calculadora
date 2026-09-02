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
  /* `url` é a página que ESTE frame mostra.
     Sem ela a tela montava o endereço somando o domínio real da loja com um
     caminho do desenho, e exibia "carnan.com.br/serum-vitamina-c" — um
     produto que não existe naquela loja. Endereço inventado por cima de
     imagem verdadeira é a pior combinação possível: parece evidência. */
  | { type: 'frame'; data: string; seq: number; url?: string }
  | { type: 'finding'; code: string; severity: Severity; title: string; at: string }
  | {
      type: 'complete'
      auditId: string
      score: number | null
      /** A ressalva de cobertura viaja junto: o número nunca chega sozinho. */
      caveat: string | null
      /**
       * O que deu e o que não deu para verificar. Opcional só para não quebrar
       * quem já fala este contrato; o motor sempre manda.
       *
       * Existe porque a tela precisava dizer algo verdadeiro no lugar da
       * manchete do desenho — que afirmava "cinco pontos, três pesam" em toda
       * auditoria. Sem estes dados a tela não tem como saber o que foi medido.
       */
      coverage?: Coverage
    }
  /** Desafio antibot, deadline, intervalo. Sem isto a tela giraria para sempre. */
  | { type: 'aborted'; auditId: string; code: string; reason: string }

/** O que foi verificado e o que não foi, com o motivo de cada um. */
export interface Coverage {
  /** Quantas checagens saíram com veredito (passou ou falhou). */
  checked: number
  /** Quantas não deram para fazer. */
  unchecked: number
  /** Uma ou duas frases de lojista, montadas pelo motor. */
  summary: string
  /** A lista inteira, na ordem da §8. */
  rules: Array<{
    id: string
    title: string
    severity: Severity
    status: 'pass' | 'fail' | 'not_applicable'
    /** Preenchido quando `status` é `not_applicable`. */
    reason: string | null
    /** O que foi observado. É isto que a tela mostra como prova do achado. */
    evidence: string[]
    /** O que dá para fazer. Vazio quando a checagem não falhou. */
    recommendation: string
  }>
}

export type AuditEventType = AuditEvent['type']

/** Estado que uma reconexão recebe: passos, sim; histórico de frames, não (§7.4). */
export interface LiveState {
  auditId: string
  /* `startedAt`/`finishedAt` são ISO, do relógio do motor. Estão no ESTADO e
     não só nos eventos porque quem reconecta recebe o estado, e sem eles a
     tela teria que ou inventar a duração das etapas que já passaram ou deixá-la
     em branco. */
  steps: Array<{
    id: StepId
    label: string
    status: 'running' | 'done' | 'failed' | 'skipped'
    detail?: string
    startedAt?: string
    finishedAt?: string
  }>
  findings: Array<{ code: string; severity: Severity; title: string }>
  finished: boolean
  score: number | null
  caveat: string | null
  /* Vai no ESTADO, e não só no evento, porque quem reconecta depois do fim
     recebe o estado — e sem isto a tela voltaria sem o resumo, que é agora o
     que ela mostra no lugar da manchete. */
  coverage?: Coverage
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
