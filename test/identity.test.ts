/**
 * A identidade vem de variável de ambiente, nunca de código. E o CPF é
 * validado antes de qualquer submissão: documento inválido por typo iria parar
 * no admin de um lojista real.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { isValidCpf, maskCpf, loadIdentity, describeIdentity } from '../src/lib/identity.ts'
import { AuditError } from '../src/lib/errors.ts'

const ENV_OK = {
  AUDIT_NAME: 'Fulano de Tal',
  AUDIT_EMAIL: 'auditoria@exemplo.com',
  AUDIT_PHONE: '(11) 90000-0000',
  AUDIT_POSTAL_CODE: '01310-100',
  AUDIT_ADDRESS: 'Avenida Exemplo',
  AUDIT_ADDRESS_NUMBER: '1000',
  AUDIT_CITY: 'São Paulo',
}

describe('isValidCpf', () => {
  test('aceita CPF com dígitos verificadores corretos', () => {
    assert.equal(isValidCpf('529.982.247-25'), true)
    assert.equal(isValidCpf('52998224725'), true)
  })

  test('recusa dígito verificador errado', () => {
    assert.equal(isValidCpf('529.982.247-26'), false)
    // 111.444.777-35 é válido; -36 não. Errei este na primeira escrita do teste.
    assert.equal(isValidCpf('111.444.777-35'), true)
    assert.equal(isValidCpf('111.444.777-36'), false)
  })

  test('recusa todos os dígitos iguais', () => {
    for (const cpf of ['00000000000', '11111111111', '99999999999']) {
      assert.equal(isValidCpf(cpf), false, cpf)
    }
  })

  test('recusa comprimento errado', () => {
    assert.equal(isValidCpf('1234567890'), false)
    assert.equal(isValidCpf('123456789012'), false)
    assert.equal(isValidCpf(''), false)
  })
})

describe('maskCpf — o documento inteiro nunca é impresso', () => {
  test('mostra só as pontas', () => {
    assert.equal(maskCpf('529.982.247-25'), '529.xxx.xxx-25')
  })
  test('entrada inválida não vaza nada', () => {
    assert.equal(maskCpf('123'), '***')
  })
})

describe('loadIdentity', () => {
  test('monta a identidade a partir do ambiente', () => {
    const id = loadIdentity(ENV_OK as NodeJS.ProcessEnv)
    assert.equal(id.firstName, 'Fulano')
    assert.equal(id.lastName, 'de Tal')
    assert.equal(id.cpf, null)
  })

  test('reclama do que faltar, dizendo qual variável', () => {
    const env = { ...ENV_OK, AUDIT_EMAIL: '' }
    assert.throws(
      () => loadIdentity(env as NodeJS.ProcessEnv),
      (e: unknown) =>
        e instanceof AuditError && e.code === 'IDENTITY_MISSING' && e.detail['variable'] === 'AUDIT_EMAIL',
    )
  })

  test('recusa CPF inválido antes de qualquer submissão', () => {
    const env = { ...ENV_OK, AUDIT_CPF: '111.111.111-11' }
    assert.throws(
      () => loadIdentity(env as NodeJS.ProcessEnv),
      (e: unknown) => e instanceof AuditError && e.code === 'IDENTITY_INVALID',
    )
  })

  test('guarda o CPF só com dígitos', () => {
    const id = loadIdentity({ ...ENV_OK, AUDIT_CPF: '529.982.247-25' } as NodeJS.ProcessEnv)
    assert.equal(id.cpf, '52998224725')
  })
})

describe('describeIdentity — o que pode sair no JSON', () => {
  test('nunca expõe o CPF inteiro', () => {
    const id = loadIdentity({ ...ENV_OK, AUDIT_CPF: '529.982.247-25' } as NodeJS.ProcessEnv)
    const out = JSON.stringify(describeIdentity(id))
    assert.ok(!out.includes('52998224725'))
    assert.ok(!out.includes('529.982.247-25'))
    assert.ok(out.includes('529.xxx.xxx-25'))
  })

  test('diz se há CPF sem precisar mostrá-lo', () => {
    const semCpf = describeIdentity(loadIdentity(ENV_OK as NodeJS.ProcessEnv))
    assert.equal(semCpf['cpfProvided'], false)
    assert.equal(semCpf['cpfMasked'], null)
  })
})
