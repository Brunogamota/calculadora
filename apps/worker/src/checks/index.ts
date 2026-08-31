/**
 * Runner das checagens e cálculo da nota (§8).
 *
 * Nota = 100 menos a soma dos pesos disparados, normalizada pelas checagens
 * APLICÁVEIS. Checagem não aplicável sai do denominador em vez de virar
 * penalidade — é o que impede uma loja de perder nota porque o robots proibiu
 * o checkout, ou porque auditamos do país errado.
 */

import { SEVERITY_WEIGHT, type CheckInput, type CheckResult, type CheckRule } from './types.ts'
import { httpsIssue } from './rules/transport.ts'
import { buyButtonObscured, checkoutSpeed, forcedLogin, stepCount } from './rules/journey.ts'
import {
  installmentUnclear,
  noCouponField,
  noSavedCard,
  noTrustSignal,
  payVisibility,
  pixDiscountLate,
} from './rules/payment.ts'
import { descriptorUnclear, mobileParity } from './rules/coverage.ts'

/** Ordem da tabela da §8; o que está fora dela vai ao fim, marcado. */
export const RULES: CheckRule[] = [
  httpsIssue,
  payVisibility,
  pixDiscountLate,
  installmentUnclear,
  stepCount,
  mobileParity,
  forcedLogin,
  descriptorUnclear,
  checkoutSpeed,
  noSavedCard,
  noCouponField,
  noTrustSignal,
  buyButtonObscured,
]

export interface Scoreboard {
  /** 0 a 100, ou null quando nenhuma checagem foi aplicável. */
  score: number | null
  applicable: number
  passed: number
  failed: number
  notApplicable: number
  /** Soma dos pesos disparados e o denominador usado, para a conta ser auditável. */
  weightFailed: number
  weightApplicable: number
  /**
   * Quanto da §8 foi de fato medido, em peso.
   *
   * Sem isto, "nota 100" com 3 de 13 checagens aplicáveis lê igual a "nota 100"
   * com as 13 — e a primeira é quase uma promessa falsa. Aconteceu numa
   * auditoria real: a loja proibia /checkout no robots, 10 checagens saíram não
   * aplicáveis, e a nota saiu 100.
   */
  coverage: {
    weightTotal: number
    ratio: number
    checksTotal: number
  }
  /** Preenchido quando a nota se apoia em pouca coisa. */
  scoreCaveat: string | null
}

export interface ChecksReport extends Scoreboard {
  results: CheckResult[]
  /** Achados, por severidade decrescente. É o que o relatório mostra primeiro. */
  findings: CheckResult[]
}

const SEVERITY_ORDER: Record<string, number> = { critica: 0, alta: 1, media: 2, baixa: 3 }

export function runChecks(input: CheckInput, rules: CheckRule[] = RULES): ChecksReport {
  const results: CheckResult[] = rules.map((rule) => ({
    id: rule.id,
    title: rule.title,
    severity: rule.severity,
    ...rule.evaluate(input),
  }))

  const applicable = results.filter((r) => r.status !== 'not_applicable')
  const failed = applicable.filter((r) => r.status === 'fail')

  const weightApplicable = applicable.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0)
  const weightFailed = failed.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0)
  const weightTotal = results.reduce((sum, r) => sum + SEVERITY_WEIGHT[r.severity], 0)
  const ratio = weightTotal === 0 ? 0 : weightApplicable / weightTotal

  // Sem nenhuma checagem aplicável não existe nota. Devolver 100 diria "loja
  // impecável" para uma auditoria que não mediu nada.
  const score =
    weightApplicable === 0 ? null : Math.round(100 * (1 - weightFailed / weightApplicable))

  // A nota é honesta dentro do que foi medido, mas apresentada sozinha ela
  // engana quando pouco foi medido. O aviso viaja junto com o número.
  const scoreCaveat =
    score === null || ratio >= 0.6
      ? null
      : `esta nota cobre apenas ${Math.round(ratio * 100)}% da §8 em peso ` +
        `(${applicable.length} de ${results.length} checagens aplicáveis). ` +
        'Ela diz que nada falhou no que foi possível medir, não que a loja está impecável.'

  return {
    score,
    applicable: applicable.length,
    passed: applicable.length - failed.length,
    failed: failed.length,
    notApplicable: results.length - applicable.length,
    weightFailed,
    weightApplicable,
    coverage: { weightTotal, ratio: Math.round(ratio * 100) / 100, checksTotal: results.length },
    scoreCaveat,
    results,
    findings: [...failed].sort(
      (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
    ),
  }
}
