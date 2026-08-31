/**
 * Classificação de overlay. O caso que motivou este arquivo:
 *
 * Auditando a Insider Store de um Codespaces fora do Brasil, um modal cobriu o
 * botão de comprar com o texto "We have a dedicated store to serve your
 * region". Um comprador brasileiro nunca veria essa tela. Reportar isso como
 * defeito da loja seria acusar o lojista de um problema que só existe porque
 * auditamos do lugar errado — resultado inventado com outro nome.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { classifyOverlay, isLikelyAuditArtifact, DISMISS_TEXT } from '../src/journey/overlays.ts'

describe('classifyOverlay', () => {
  test('reconhece o modal real da Insider Store', () => {
    assert.equal(
      classifyOverlay('We have a dedicated store to serve your region. Would you like to go there?'),
      'geo-redirect',
    )
  })

  test('reconhece a versão em português', () => {
    assert.equal(classifyOverlay('Temos uma loja para a sua região'), 'geo-redirect')
    assert.equal(classifyOverlay('Você está em outro país. Mudar de país?'), 'geo-redirect')
  })

  test('separa cookie de marketing', () => {
    assert.equal(classifyOverlay('Usamos cookies. Aceitar todos?'), 'consent')
    assert.equal(classifyOverlay('Assine a newsletter e ganhe 10% de desconto'), 'marketing')
  })

  test('overlay sem pista fica unknown, não chuta', () => {
    assert.equal(classifyOverlay('Atenção'), 'unknown')
    assert.equal(classifyOverlay(''), 'unknown')
  })
})

describe('isLikelyAuditArtifact — a trava contra acusar a loja errado', () => {
  test('geo-redirect visto de fora do Brasil é artefato', () => {
    assert.equal(isLikelyAuditArtifact('geo-redirect', null), true)
    assert.equal(isLikelyAuditArtifact('geo-redirect', false), true)
  })

  test('geo-redirect visto DE DENTRO do Brasil é achado de verdade', () => {
    // Se o comprador brasileiro vê o modal, o problema é da loja mesmo.
    assert.equal(isLikelyAuditArtifact('geo-redirect', true), false)
  })

  test('cookie e newsletter nunca são artefato: o comprador vê de qualquer lugar', () => {
    for (const from of [true, false, null]) {
      assert.equal(isLikelyAuditArtifact('consent', from), false)
      assert.equal(isLikelyAuditArtifact('marketing', from), false)
      assert.equal(isLikelyAuditArtifact('unknown', from), false)
    }
  })

  test('o padrão desconhecido protege a loja, não o relatório', () => {
    // Sem saber de onde auditamos, presumir artefato deixa de reportar um
    // achado possível. O contrário acusaria de um defeito inexistente — e
    // relatório errado queima a ferramenta na primeira vez.
    assert.equal(isLikelyAuditArtifact('geo-redirect', null), true)
  })
})

describe('DISMISS_TEXT — fechar sem sair da loja', () => {
  test('reconhece o que fecha', () => {
    const fecham = [
      'Fechar', 'Close', '×', 'Continuar no site', 'Ficar aqui',
      'Não, obrigado', 'Nao obrigado', 'No thanks', 'Agora não', 'Entendi',
    ]
    for (const texto of fecham) {
      assert.ok(DISMISS_TEXT.test(texto), `deveria fechar: ${texto}`)
    }
  })

  test('não confunde com o botão que leva para outra loja', () => {
    for (const texto of ['Ir para a loja internacional', 'Go to US store', 'Mudar para outro país']) {
      assert.ok(!DISMISS_TEXT.test(texto), `não deveria clicar: ${texto}`)
    }
  })
})
