/**
 * A jornada não compra add-on: item sem entrega física fica fora.
 *
 * Na auditoria da allbirds a escolha caiu em "Free Returns Coverage" — um
 * seguro de devolução. A regra da §6.3 é "o mais barato disponível", e add-on
 * de proteção é sempre o mais barato do catálogo, então ele ganha todas as
 * vezes. O checkout que se abriu depois não representava compra nenhuma.
 *
 * O motivo de excluir já estava escrito no `pickProduct`, no comentário do
 * vale-presente: "não tem frete e distorce a jornada de checkout". Faltava
 * aplicar a mesma régua ao resto — e pelo campo estrutural
 * (`requires_shipping`, que o `/products.json` público do Shopify traz), não
 * por lista de nomes, que não escala.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { audit, type AuditResult } from '../../src/audit.ts'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'

const aceiteDe = (url: string) => ({ em: new Date().toISOString(), url, texto: 'teste' })

describe('produto sem entrega física', { concurrency: false }, () => {
  describe('catálogo com add-on de proteção, mais barato que tudo', () => {
    let loja: FakeStore
    let r: AuditResult

    before(async () => {
      process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
      process.env['AUDIT_COOLDOWN_HOURS'] = '0'
      process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
      loja = await startFakeStore({ protecaoDeEnvio: true })
      r = await audit(loja.url, { modo: 'consentido', aceite: aceiteDe(loja.url), headed: false })
    })
    after(async () => {
      await loja.close()
    })

    test('não escolhe a proteção de envio', () => {
      assert.ok(r.product, 'a jornada não escolheu produto nenhum')
      assert.doesNotMatch(
        r.product.url,
        /protecao-de-envio/,
        `a jornada comprou o add-on: ${r.product.url}`,
      )
    })

    test('escolhe o mais barato ENTRE os que têm frete', () => {
      // Camiseta 89,90 é a mais barata com entrega; a proteção custa 4,90.
      assert.match(r.product?.url ?? '', /camiseta-basica/)
    })

    test('e a auditoria segue até o fim', () => {
      assert.notEqual(r.status, 'failed')
    })
  })

  describe('loja 100% digital: curso e ebook, nada com frete', () => {
    let loja: FakeStore
    let r: AuditResult

    before(async () => {
      loja = await startFakeStore({ soDigital: true })
      r = await audit(loja.url, { modo: 'consentido', aceite: aceiteDe(loja.url), headed: false })
    })
    after(async () => {
      await loja.close()
    })

    test('NÃO fica sem auditoria: a exclusão não pode ser absoluta', () => {
      /* Recusar a loja inteira seria trocar um resultado errado por nenhum
         resultado — e loja de curso é loja. */
      assert.ok(r.product, 'a loja digital ficou sem produto escolhido')
      assert.match(r.product.url, /curso-de-marketing|ebook-vendas/)
    })

    test('e o relatório diz que ali não há etapa de frete', () => {
      const nota = r.storefrontNotes.find((n) => n.includes('sem entrega física'))
      assert.ok(nota, `nenhuma observação sobre a loja digital: ${JSON.stringify(r.storefrontNotes)}`)
      assert.match(nota, /não há etapa de frete/)
    })
  })
})
