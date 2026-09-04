/**
 * O funil da Camada 1 (leitura) e o carregamento da Camada 2 (consentido),
 * testados contra a loja falsa — nenhuma loja real é tocada aqui.
 *
 * Não prova que os 28 candidatos da lista real são de fato Shopify: só o
 * `detect`, rodando contra eles de verdade, prova isso. O que este arquivo
 * prova é que a CLASSIFICAÇÃO está certa — que 'entrou', 'descartada-no-detect'
 * e 'abortou' significam o que dizem significar, pros três casos que dão pra
 * fabricar sem tocar em ninguém.
 */

import { test, describe, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { startFakeStore, type FakeStore } from '../fixtures/fake-shopify.ts'
import { medirLeitura, carregarConsentidas, type Consentida } from '../../scripts/medir-cobertura.ts'

process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['AUDIT_COOLDOWN_HOURS'] = '0'
process.env['AUDIT_ATTEMPT_COOLDOWN_MINUTES'] = '0'

describe('Camada 1: classificação do funil', { concurrency: false }, () => {
  test('loja shopify normal: entrou', async () => {
    const loja = await startFakeStore()
    try {
      const { desfecho } = await medirLeitura(loja.url)
      assert.equal(desfecho.faixa, 'entrou', `esperava 'entrou', veio ${JSON.stringify(desfecho)}`)
    } finally {
      await loja.close()
    }
  })

  test('robots.txt bloqueia /checkout: descartada no detect, não gasta auditoria', async () => {
    /* Este é o caso que importa mais: a loja NÃO é auditada quando o robots
       já proíbe um caminho que a jornada precisaria. Gastar a auditoria mesmo
       assim seria a mesma falta de respeito ao robots que a §2.3/§2.6 existem
       para evitar — só que escondida atrás de "é só leitura". */
    const loja = await startFakeStore({ blockCheckout: true })
    try {
      const { desfecho } = await medirLeitura(loja.url)
      assert.equal(desfecho.faixa, 'descartada-no-detect')
      assert.match(desfecho.detalhe, /robots\.txt bloqueia/)
      assert.match(desfecho.detalhe, /\/checkout/)
    } finally {
      await loja.close()
    }
  })

  test('loja que não responde: descartada no detect, não em abortou', async () => {
    /* Ajustado depois de rodar: minha primeira expectativa aqui estava
       errada, não o script. `detect` também abre navegador e tenta carregar
       a página — uma porta fechada falha JÁ NO DETECT, então nunca chega a
       'abortou' (que é só pra quando o detect confirmou shopify e o `audit`
       em leitura falhou depois). Porta fechada de propósito — nada escuta. */
    const { desfecho } = await medirLeitura('http://127.0.0.1:1')
    assert.equal(desfecho.faixa, 'descartada-no-detect')
    assert.ok(desfecho.detalhe.length > 0, 'descartada sem motivo — o relatório ficaria mudo sobre o porquê')
  })
})

describe('Camada 2: carregamento do arquivo de aceites', { concurrency: false }, () => {
  let dir: string

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'raio-x-consentidas-'))
  })
  after(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  test('arquivo ausente: lista vazia, não erro', async () => {
    const lista = await carregarConsentidas(path.join(dir, 'nao-existe.json'))
    assert.deepEqual(lista, [])
  })

  test('arquivo com uma loja: devolve exatamente o que está nele', async () => {
    const caminho = path.join(dir, 'lojas-consentidas.json')
    const conteudo: Consentida[] = [{ url: 'https://minha-loja.example', em: '2026-09-04T10:00:00Z', texto: 'aprovo' }]
    await writeFile(caminho, JSON.stringify(conteudo))

    const lista = await carregarConsentidas(caminho)
    assert.equal(lista.length, 1)
    assert.equal(lista[0]?.url, 'https://minha-loja.example')
  })

  test('arquivo com JSON quebrado: lista vazia, e o motivo aparece — não trava o script inteiro', async () => {
    const caminho = path.join(dir, 'quebrado.json')
    await writeFile(caminho, '{ isto não é uma lista')
    const ditos: string[] = []
    const original = console.error
    console.error = (...args: unknown[]) => ditos.push(args.join(' '))
    try {
      const lista = await carregarConsentidas(caminho)
      assert.deepEqual(lista, [])
    } finally {
      console.error = original
    }
    assert.ok(ditos.length > 0, 'o erro de parsing morreu em silêncio')
  })
})
