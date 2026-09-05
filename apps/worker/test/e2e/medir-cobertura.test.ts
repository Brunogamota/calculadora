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
import {
  medirLeitura,
  carregarConsentidas,
  leuATelaDePagamento,
  type Consentida,
} from '../../scripts/medir-cobertura.ts'
import type { AuditResult } from '../../src/audit.ts'

process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
process.env['RAIO_X_SEGREDO_TITULARIDADE'] ??= 'segredo-de-teste-com-tamanho-suficiente'
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
    const conteudo: Consentida[] = [{ url: 'https://minha-loja.example', em: '2026-09-04T10:00:00Z', texto: 'aprovo', propria: false }]
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

  test('loja própria (variável de ambiente) entra na lista mesmo sem arquivo', async () => {
    const lista = await carregarConsentidas(path.join(dir, 'nao-existe-2.json'), {
      RAIO_X_LOJA_PROPRIA: 'https://raiox-teste.myshopify.com',
    })
    assert.equal(lista.length, 1)
    assert.equal(lista[0]?.url, 'https://raiox-teste.myshopify.com')
    assert.ok(lista[0]?.texto.length, 'o aceite da loja própria veio sem texto')
  })

  test('loja própria vem JUNTO com as do arquivo, não no lugar delas', async () => {
    const caminho = path.join(dir, 'com-loja-propria.json')
    const doArquivo: Consentida[] = [{ url: 'https://outra-loja.example', em: '2026-09-04T10:00:00Z', texto: 'aprovo', propria: false }]
    await writeFile(caminho, JSON.stringify(doArquivo))

    const lista = await carregarConsentidas(caminho, { RAIO_X_LOJA_PROPRIA: 'https://raiox-teste.myshopify.com' })
    assert.equal(lista.length, 2)
    assert.ok(lista.some((l) => l.url === 'https://raiox-teste.myshopify.com'))
    assert.ok(lista.some((l) => l.url === 'https://outra-loja.example'))
  })

  test('sem a variável de ambiente, nenhuma loja própria aparece', async () => {
    const lista = await carregarConsentidas(path.join(dir, 'nao-existe-3.json'), {})
    assert.deepEqual(lista, [])
  })

  test('só a loja do ambiente é marcada como própria — é ela que pode repetir no mesmo dia', async () => {
    const caminho = path.join(dir, 'quem-e-propria.json')
    const doArquivo: Consentida[] = [
      { url: 'https://terceiro.example', em: '2026-09-04T10:00:00Z', texto: 'aprovo', propria: false },
    ]
    await writeFile(caminho, JSON.stringify(doArquivo))

    const lista = await carregarConsentidas(caminho, { RAIO_X_LOJA_PROPRIA: 'https://raiox-teste.myshopify.com' })
    assert.equal(lista.find((l) => l.url === 'https://raiox-teste.myshopify.com')?.propria, true)
    assert.equal(lista.find((l) => l.url === 'https://terceiro.example')?.propria, false)
  })

  test('sucesso da Camada 2 é a tela de pagamento, não a porta do checkout', () => {
    /* O caso da allbirds, que `audit.ts:766` registra: o /checkout abriu (e o
       passo reach-checkout ficou `done`), mas o carrinho estava vazio e a tela
       de pagamento nunca veio. Medir pelo passo dava certinho por cima disso. */
    const abriuMasNaoPagou = {
      steps: [{ id: 'reach-checkout', outcome: { status: 'done' } }],
      checkout: { reachedPaymentScreen: false },
    } as unknown as AuditResult
    assert.equal(leuATelaDePagamento(abriuMasNaoPagou), false)
  })

  test('a tela de pagamento conta mesmo sem passo `read-payment` na trilha', () => {
    /* `read-payment` existe só nos eventos ao vivo do reporter, nunca em
       `resultado.steps` — procurá-lo ali dava zero até numa loja perfeita. */
    const chegouNoPagamento = {
      steps: [{ id: 'reach-checkout', outcome: { status: 'done' } }],
      checkout: { reachedPaymentScreen: true },
    } as unknown as AuditResult
    assert.equal(leuATelaDePagamento(chegouNoPagamento), true)
  })

  test('jornada que nem chegou ao checkout não conta como pagamento lido', () => {
    const morreuAntes = { steps: [], checkout: null } as unknown as AuditResult
    assert.equal(leuATelaDePagamento(morreuAntes), false)
  })

  test('"propria": true escrito no arquivo à mão não libera repetição contra loja de terceiro', async () => {
    const caminho = path.join(dir, 'mentindo.json')
    await writeFile(
      caminho,
      JSON.stringify([{ url: 'https://terceiro.example', em: '2026-09-04T10:00:00Z', texto: 'aprovo', propria: true }]),
    )

    const lista = await carregarConsentidas(caminho, {})
    assert.equal(lista[0]?.propria, false, 'o arquivo conseguiu se declarar loja própria')
  })
})
