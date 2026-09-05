/**
 * `--from-br` é uma declaração de verdade, e declarada por engano de um
 * datacenter ela produz falso positivo: tempo de carregamento vira achado
 * injusto, e modal de região deixa de ser tratado como artefato.
 *
 * Aconteceu de verdade: a flag foi usada dentro do VS Code web (Codespaces).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { detectCloudEnvironment, vantageContradiction, origemBrasileiraDoAmbiente } from '../src/lib/environment.ts'

describe('detectCloudEnvironment', () => {
  test('reconhece Codespaces, que é onde isso aconteceu', () => {
    assert.equal(detectCloudEnvironment({ CODESPACES: 'true' })?.name, 'GitHub Codespaces')
  })

  test('reconhece outros ambientes de nuvem', () => {
    assert.equal(detectCloudEnvironment({ GITPOD_WORKSPACE_ID: 'abc' })?.name, 'Gitpod')
    assert.equal(detectCloudEnvironment({ GITHUB_ACTIONS: 'true' })?.name, 'GitHub Actions')
    assert.equal(detectCloudEnvironment({ CLOUD_SHELL: 'true' })?.name, 'Google Cloud Shell')
  })

  test('máquina comum não é ambiente de nuvem', () => {
    assert.equal(detectCloudEnvironment({ HOME: '/Users/bruno', SHELL: '/bin/zsh' }), null)
  })

  test('variável presente com valor errado não conta', () => {
    assert.equal(detectCloudEnvironment({ CODESPACES: 'false' }), null)
  })
})

describe('vantageContradiction', () => {
  test('avisa quando --from-br é declarado dentro do Codespaces', () => {
    const aviso = vantageContradiction(true, { CODESPACES: 'true' })
    assert.ok(aviso)
    assert.match(aviso, /Codespaces/)
    assert.match(aviso, /datacenter/)
  })

  test('sem a flag, não há contradição a avisar', () => {
    assert.equal(vantageContradiction(undefined, { CODESPACES: 'true' }), null)
    assert.equal(vantageContradiction(false, { CODESPACES: 'true' }), null)
  })

  test('--from-br numa máquina comum é aceito em silêncio', () => {
    assert.equal(vantageContradiction(true, { HOME: '/Users/bruno' }), null)
  })

  test('o motor avisa, não recusa: quem roda é quem sabe', () => {
    // Recusar seria presumir que a detecção de ambiente é mais confiável que a
    // pessoa. O aviso vai no resultado, para quem lê o relatório também ver.
    const aviso = vantageContradiction(true, { CODESPACES: 'true' })
    assert.ok(aviso!.includes('sua própria máquina'))
  })
})

describe('origemBrasileiraDoAmbiente', () => {
  test('Fly em gru é São Paulo: a plataforma diz, não a gente adivinha', () => {
    /* Produção roda em gru e ninguém passava `--from-br`, que é flag de CLI.
       Numa auditoria real isso descartou CHECKOUT_SPEED com o motivo "a
       auditoria não saiu de IP brasileiro" — sobre um checkout medido em
       2507ms que SAIU. */
    const r = origemBrasileiraDoAmbiente({ FLY_REGION: 'gru' })
    assert.equal(r?.regiao, 'gru')
    assert.equal(r?.plataforma, 'Fly.io')
    assert.equal(r?.variavel, 'FLY_REGION', 'sem a variável, o relatório não pode mostrar a prova')
  })

  test('Fly fora do Brasil não vira origem brasileira', () => {
    assert.equal(origemBrasileiraDoAmbiente({ FLY_REGION: 'iad' }), null)
    assert.equal(origemBrasileiraDoAmbiente({ FLY_REGION: 'gig' }), null)
  })

  test('ambiente sem pista nenhuma não afirma nada', () => {
    assert.equal(origemBrasileiraDoAmbiente({}), null)
  })

  test('maiúscula e espaço não escondem a região', () => {
    assert.equal(origemBrasileiraDoAmbiente({ FLY_REGION: ' GRU ' })?.regiao, 'gru')
  })
})
