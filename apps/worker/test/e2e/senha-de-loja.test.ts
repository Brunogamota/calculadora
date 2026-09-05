/**
 * A auditoria contra loja com senha diz a verdade, não "não devolveu JSON
 * válido".
 *
 * Achado numa loja real (`raiox-teste.myshopify.com`, ainda em
 * desenvolvimento): `/products.json` responde 200 com a página de senha do
 * Shopify em HTML no lugar do catálogo. Antes desta correção, o `JSON.parse`
 * falhava e o erro saía como `CATALOG_UNREADABLE` — verdade técnica, mas que
 * não diz ao lojista que a solução é dele: publicar a loja ou tirar a senha.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { audit, type AuditResult } from '../../src/audit.ts'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'

const aceiteDe = (url: string) => ({ em: new Date().toISOString(), url, texto: 'teste' })

describe('loja ainda com senha ativa', { concurrency: false }, () => {
  let loja: FakeStore
  let r: AuditResult

  before(async () => {
    process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
    process.env['RAIO_X_SEGREDO_TITULARIDADE'] ??= 'segredo-de-teste-com-tamanho-suficiente'
    process.env['AUDIT_COOLDOWN_HOURS'] = '0'
    process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
    loja = await startFakeStore({ titularidadeVerificada: true, comSenha: true })
    r = await audit(loja.url, { modo: 'consentido', aceite: aceiteDe(loja.url), headed: false })
  })
  after(async () => {
    await loja.close()
  })

  test('erra com STORE_PASSWORD_PROTECTED, não com CATALOG_UNREADABLE', () => {
    assert.equal(r.errorCode, 'STORE_PASSWORD_PROTECTED', `veio ${r.errorCode}: ${r.errorReason}`)
  })

  test('a mensagem diz ao lojista o que fazer, não fala em JSON', () => {
    assert.match(r.errorReason ?? '', /senha/i)
    assert.doesNotMatch(r.errorReason ?? '', /JSON/i)
  })
})
