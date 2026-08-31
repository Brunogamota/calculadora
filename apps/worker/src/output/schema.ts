/**
 * Esquema Zod da saída (§17: "imprime JSON tipado").
 *
 * O motor valida o PRÓPRIO resultado antes de imprimir. Parece redundante com o
 * TypeScript, mas não é: o TS garante a forma em tempo de compilação, e aqui a
 * gente pega o que escapa em tempo de execução — campo que virou `undefined`
 * por um caminho não previsto, número que virou NaN, união que ganhou um valor
 * novo. Numa ferramenta cujo princípio nº 1 é não entregar resultado inventado,
 * imprimir JSON malformado é a versão silenciosa do mesmo problema.
 */

import { z } from 'zod'

const severity = z.enum(['critica', 'alta', 'media', 'baixa'])

const checkResult = z.object({
  id: z.string(),
  title: z.string(),
  severity,
  status: z.enum(['pass', 'fail', 'not_applicable']),
  evidence: z.array(z.string()),
  notApplicableReason: z.string().nullable(),
  recommendation: z.string(),
  screenshot: z.string().nullable(),
})

const checksReport = z.object({
  score: z.number().int().min(0).max(100).nullable(),
  applicable: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  notApplicable: z.number().int().nonnegative(),
  weightFailed: z.number().nonnegative(),
  weightApplicable: z.number().nonnegative(),
  coverage: z.object({
    weightTotal: z.number().nonnegative(),
    ratio: z.number().min(0).max(1),
    checksTotal: z.number().int().nonnegative(),
  }),
  scoreCaveat: z.string().nullable(),
  results: z.array(checkResult),
  findings: z.array(checkResult),
})

const stepOutcome = z.discriminatedUnion('status', [
  z.object({ status: z.literal('done') }),
  z.object({ status: z.literal('skipped'), reason: z.string() }),
  z.object({ status: z.literal('not_permitted_by_robots'), path: z.string() }),
  z.object({ status: z.literal('failed'), code: z.string(), reason: z.string() }),
])

const journeyStep = z.object({
  id: z.string(),
  label: z.string(),
  url: z.string(),
  at: z.string(),
  ms: z.number().nonnegative(),
  screenshot: z.string().nullable(),
  httpsOk: z.boolean(),
  outcome: stepOutcome,
})

const paymentSnapshot = z.object({
  methods: z.array(z.object({ label: z.string(), position: z.number().int(), evidence: z.string() })),
  pix: z.object({
    present: z.boolean(),
    discountShownHere: z.boolean().nullable(),
    discountShownEarlier: z.boolean().nullable(),
  }),
  installments: z.object({
    present: z.boolean(),
    maxCount: z.number().int().nullable(),
    perInstallmentValueShown: z.boolean().nullable(),
    interestExplicit: z.boolean().nullable(),
    rawText: z.string().nullable(),
  }),
  couponField: z.boolean().nullable(),
  trustSignals: z.object({ present: z.boolean().nullable(), evidence: z.array(z.string()) }),
  saveCard: z.boolean().nullable(),
  cpfField: z.boolean().nullable(),
  gateway: z.string().nullable(),
  rawTextSample: z.string(),
})

export const auditResultSchema = z.object({
  ok: z.boolean(),
  status: z.enum(['done', 'partial', 'failed']),
  url: z.string(),
  finalDomain: z.string(),
  platform: z.string().nullable(),
  platformConfidence: z.string().nullable(),
  storefrontNotes: z.array(z.string()),
  product: z
    .object({
      url: z.string(),
      title: z.string(),
      priceCents: z.number().int().nullable(),
      variantId: z.string().nullable(),
      available: z.boolean(),
      source: z.string(),
      requiresVariantChoice: z.boolean(),
    })
    .nullable(),
  cart: z
    .object({
      ok: z.boolean().nullable(),
      ms: z.number().nonnegative(),
      uiPattern: z.enum(['drawer', 'modal', 'redirect', 'inline', 'unknown']),
      cartUrl: z.string(),
      itemCount: z.number().int().nullable(),
      cartReadNote: z.string().nullable(),
      clicks: z.number().int().nonnegative(),
      overlay: z.object({
        present: z.boolean(),
        identity: z.string().nullable(),
        kind: z.enum(['geo-redirect', 'consent', 'marketing', 'unknown']),
        text: z.string().nullable(),
        dismissed: z.boolean(),
        dismissAttempts: z.array(z.string()),
        clickRequiredForce: z.boolean(),
        likelyAuditArtifact: z.boolean(),
      }),
    })
    .nullable(),
  checkout: z
    .object({
      url: z.string(),
      reachedPaymentScreen: z.boolean(),
      forcedLogin: z.boolean().nullable(),
      stepsFromProduct: z.number().int().nonnegative(),
      clicksFromProduct: z.number().int().nonnegative(),
      loadMs: z.object({
        home: z.number().nullable(),
        product: z.number().nullable(),
        checkout: z.number().nullable(),
      }),
      allHttps: z.boolean(),
      trail: z.array(journeyStep),
    })
    .nullable(),
  payment: paymentSnapshot.nullable(),
  identity: z.record(z.string(), z.unknown()).nullable(),
  checks: checksReport.nullable(),
  steps: z.array(journeyStep),
  screenshotsDir: z.string().nullable(),
  robots: z.object({
    ownerVerified: z.boolean(),
    blockedPaths: z.array(z.string()),
    overridesUsed: z.array(z.object({ path: z.string(), at: z.string() })),
  }),
  incompleteBecause: z.array(z.string()),
  vantage: z.object({
    auditedFromBrazil: z.boolean().nullable(),
    locale: z.string(),
    timezone: z.string(),
    note: z.string().nullable(),
  }),
  errorCode: z.string().nullable(),
  errorReason: z.string().nullable(),
  errorDetail: z.record(z.string(), z.unknown()).nullable(),
  timings: z.object({ totalMs: z.number().nonnegative(), homeLoadMs: z.number().nullable() }),
})

export interface ValidationOutcome {
  valid: boolean
  issues: string[]
}

/**
 * Valida sem lançar: um resultado que não bate no esquema ainda deve ser
 * impresso, porque ele carrega o diagnóstico. O que não pode é sair como se
 * estivesse íntegro.
 */
export function validateAuditResult(value: unknown): ValidationOutcome {
  const parsed = auditResultSchema.safeParse(value)
  if (parsed.success) return { valid: true, issues: [] }
  return {
    valid: false,
    issues: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.') || '(raiz)'}: ${i.message}`),
  }
}
