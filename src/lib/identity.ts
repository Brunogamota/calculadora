/**
 * Identidade usada para preencher contato e entrega no checkout (§6.5).
 *
 * Vem SEMPRE de variável de ambiente, nunca de código. CPF, telefone e endereço
 * num repositório Git ficam no histórico para sempre — e este repo é público
 * ou pode vir a ser. O `.env` está no `.gitignore`; o `.env.example` mostra a
 * forma, sem valor real.
 *
 * O que é preenchido aqui vira checkout abandonado no admin do lojista, com
 * dado pessoal de verdade. Por isso a identidade é obrigatória e explícita: o
 * motor não inventa nome nem gera CPF.
 */

import { AuditError } from './errors.ts'

export interface AuditIdentity {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  postalCode: string
  address1: string
  addressNumber: string
  city: string | null
  /** Só dígitos. Nunca sai em log nem no JSON de saída. */
  cpf: string | null
}

/** Dígitos verificadores do CPF. Evita submeter documento inválido por typo. */
export function isValidCpf(input: string): boolean {
  const digits = input.replace(/\D/g, '')
  if (digits.length !== 11) return false
  if (/^(\d)\1{10}$/.test(digits)) return false

  for (const [length, position] of [
    [9, 10],
    [10, 11],
  ] as const) {
    let sum = 0
    for (let i = 0; i < length; i++) sum += Number(digits[i]) * (position - i)
    const remainder = (sum * 10) % 11
    const check = remainder === 10 ? 0 : remainder
    if (check !== Number(digits[length])) return false
  }
  return true
}

/** Para log e saída: 449.xxx.xxx-02. O documento inteiro nunca é impresso. */
export function maskCpf(cpf: string): string {
  const d = cpf.replace(/\D/g, '')
  if (d.length !== 11) return '***'
  return `${d.slice(0, 3)}.xxx.xxx-${d.slice(9)}`
}

function required(name: string, value: string | undefined): string {
  if (!value || !value.trim()) {
    throw new AuditError('IDENTITY_MISSING', `${name} não definido. Preencha o .env (veja .env.example)`, {
      variable: name,
    })
  }
  return value.trim()
}

export function loadIdentity(env: NodeJS.ProcessEnv = process.env): AuditIdentity {
  const fullName = required('AUDIT_NAME', env['AUDIT_NAME'])
  const parts = fullName.split(/\s+/)
  const cpfRaw = env['AUDIT_CPF']?.replace(/\D/g, '') ?? ''

  if (cpfRaw && !isValidCpf(cpfRaw)) {
    throw new AuditError('IDENTITY_INVALID', 'AUDIT_CPF não passa na checagem de dígito verificador', {
      cpf: maskCpf(cpfRaw),
    })
  }

  return {
    fullName,
    firstName: parts[0] ?? fullName,
    lastName: parts.length > 1 ? parts.slice(1).join(' ') : '',
    email: required('AUDIT_EMAIL', env['AUDIT_EMAIL']),
    phone: required('AUDIT_PHONE', env['AUDIT_PHONE']),
    postalCode: required('AUDIT_POSTAL_CODE', env['AUDIT_POSTAL_CODE']),
    address1: required('AUDIT_ADDRESS', env['AUDIT_ADDRESS']),
    addressNumber: required('AUDIT_ADDRESS_NUMBER', env['AUDIT_ADDRESS_NUMBER']),
    city: env['AUDIT_CITY']?.trim() || null,
    cpf: cpfRaw || null,
  }
}

/** Resumo seguro para o JSON de saída: identifica sem expor. */
export function describeIdentity(identity: AuditIdentity): Record<string, unknown> {
  return {
    name: identity.fullName,
    email: identity.email,
    cpfProvided: identity.cpf !== null,
    cpfMasked: identity.cpf ? maskCpf(identity.cpf) : null,
  }
}

/** Carrega o .env se existir. Ausência não é erro: só quem preenche precisa. */
export function loadDotEnv(path = '.env'): void {
  try {
    process.loadEnvFile(path)
  } catch {
    /* sem .env, segue com o ambiente do processo */
  }
}
