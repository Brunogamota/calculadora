/**
 * Sobreposição na ENTRADA e no CARRINHO, não só em cima do botão de comprar.
 *
 * A rotina de fechar existia e era boa — Esc, rótulo acessível, texto visível
 * — mas morava dentro do `addToCart`, condicionada a `findBlocker(button)`,
 * que pergunta "tem algo cobrindo ESTE botão?". Banner de cookie na entrada,
 * popup de oferta e gaveta de carrinho não cobrem botão nenhum, e ninguém os
 * fechava. Loja que trava a interação até aceitar derrubava a auditoria.
 *
 * Aqui a loja falsa põe sobreposição nos dois lugares que a fixture não tinha.
 * O caso da oferta é o mais duro de propósito: sem `role="dialog"`, sem rótulo
 * acessível de fechar, e o botão diz "Não, obrigado" — só o léxico resolve.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { audit, type AuditResult } from '../../src/audit.ts'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'

describe('sobreposição na entrada e no carrinho', { concurrency: false }, () => {
  let loja: FakeStore
  let r: AuditResult

  before(async () => {
    process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
    process.env['RAIO_X_SEGREDO_TITULARIDADE'] ??= 'segredo-de-teste-com-tamanho-suficiente'
    process.env['AUDIT_COOLDOWN_HOURS'] = '0'
    process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'
    loja = await startFakeStore({ titularidadeVerificada: true, overlayNaHome: 'consent', overlayNoCarrinho: 'oferta' })
    r = await audit(loja.url, {
      modo: 'consentido',
      aceite: { em: new Date().toISOString(), url: loja.url, texto: 'teste de sobreposição' },
      headed: false,
      /* De IP brasileiro: sem isto um overlay classificado como geo viraria
         artefato, e o teste passaria por um motivo diferente do que testa. */
      fromBrazil: true,
    })
  })

  after(async () => {
    await loja.close()
  })

  test('o aviso de cookies da ENTRADA vira observação sobre a loja', () => {
    const nota = r.storefrontNotes.find((n) => n.startsWith('Ao abrir a loja,'))
    assert.ok(
      nota,
      `nenhuma observação sobre a entrada. Observações: ${JSON.stringify(r.storefrontNotes)}`,
    )
    assert.match(nota, /aviso de cookies/)
  })

  test('e diz que foi fechado, com quantos cliques custou', () => {
    const nota = r.storefrontNotes.find((n) => n.startsWith('Ao abrir a loja,')) ?? ''
    assert.match(nota, /a auditoria fechou em \d+ clique/)
    // O toque a mais é do comprador também: é isso que a frase precisa dizer.
    assert.match(nota, /O comprador precisa do mesmo toque a mais/)
  })

  test('o popup de oferta do CARRINHO também é fechado e registrado', () => {
    const nota = r.storefrontNotes.find((n) => n.startsWith('No carrinho,'))
    assert.ok(
      nota,
      `nenhuma observação sobre o carrinho. Observações: ${JSON.stringify(r.storefrontNotes)}`,
    )
    assert.match(nota, /popup de oferta/)
    assert.match(nota, /a auditoria fechou/)
  })

  test('sobreposição não vira ACHADO: a nota continua sendo das 13 da §8', () => {
    /* A decisão de produto: entrada e carrinho são observação, não checagem.
       Uma 14ª checagem criada em silêncio mudaria o significado da nota, que é
       normalizada pelas aplicáveis. */
    assert.equal(r.checks?.results.length, 13)
    const inventadas = r.checks?.findings.filter((f) =>
      /sobreposi|cookie|popup|oferta/i.test(f.title),
    )
    assert.deepEqual(inventadas, [], 'sobreposição virou achado contra a loja')
  })

  test('e a jornada chega ao fim, em vez de travar atrás do aviso', () => {
    assert.notEqual(r.status, 'failed')
    assert.ok(r.cart, 'a jornada não chegou ao carrinho')
  })
})
