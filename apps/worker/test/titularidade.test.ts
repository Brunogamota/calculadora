/**
 * A prova de titularidade, testada contra servidor de verdade — não fixture.
 *
 * O que estes testes trancam é o buraco que existia: `server.ts` preenchia o
 * aceite sozinho, então `{"modo":"consentido","aceite":{}}` bastava para o
 * robô ignorar o robots.txt de uma loja de terceiro.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import {
  tokenPara,
  lerEtiqueta,
  segredoDoAmbiente,
  verificarTitularidade,
  META_NAME,
} from '../src/lib/titularidade.ts'
import { createSafeFetch } from '../src/lib/http.ts'
import { HostRateLimiter } from '../src/lib/ratelimit.ts'
import { AuditError } from '../src/lib/errors.ts'

process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'

const SEGREDO = 'segredo-de-teste-com-tamanho-suficiente'

function subirLoja(opcoes: { etiqueta?: string; status?: number; robotsProibeHome?: boolean } = {}) {
  const server = http.createServer((req, res) => {
    const p = new URL(req.url ?? '/', 'http://localhost').pathname
    if (p === '/robots.txt') {
      res.writeHead(200, { 'content-type': 'text/plain' })
      res.end(opcoes.robotsProibeHome ? 'User-agent: *\nDisallow: /\n' : 'User-agent: *\nAllow: /\n')
      return
    }
    const meta = opcoes.etiqueta === undefined ? '' : `<meta name="${META_NAME}" content="${opcoes.etiqueta}">`
    res.writeHead(opcoes.status ?? 200, { 'content-type': 'text/html; charset=utf-8' })
    res.end(`<!doctype html><html><head><title>loja</title>${meta}</head><body>oi</body></html>`)
  })
  return new Promise<{ url: string; close: () => Promise<void> }>((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      resolve({ url: `http://127.0.0.1:${port}/`, close: () => new Promise((r) => server.close(() => r())) })
    })
  })
}

const fetchar = () => createSafeFetch(new HostRateLimiter(0))

describe('token de titularidade', () => {
  test('o mesmo domínio devolve sempre o mesmo token', () => {
    assert.equal(tokenPara('loja.com.br', SEGREDO), tokenPara('loja.com.br', SEGREDO))
  })

  test('domínios diferentes devolvem tokens diferentes', () => {
    assert.notEqual(tokenPara('loja.com.br', SEGREDO), tokenPara('outra.com.br', SEGREDO))
  })

  test('segredo diferente muda o token — é o que impede derivar lendo o repositório', () => {
    assert.notEqual(tokenPara('loja.com.br', SEGREDO), tokenPara('loja.com.br', SEGREDO + 'x'))
  })

  test('www não cria um domínio novo: o lojista não deveria ter que adivinhar qual colar', () => {
    assert.equal(tokenPara('www.loja.com.br', SEGREDO), tokenPara('loja.com.br', SEGREDO))
  })

  test('sem a variável de ambiente, recusa em vez de cair para um padrão', () => {
    assert.throws(() => segredoDoAmbiente({}), (e: unknown) => e instanceof AuditError && e.code === 'CONFIG_INVALIDA')
  })

  test('segredo curto é recusado igual a segredo ausente', () => {
    assert.throws(() => segredoDoAmbiente({ RAIO_X_SEGREDO_TITULARIDADE: 'curto' }), AuditError)
  })
})

describe('leitura da etiqueta no HTML', () => {
  test('acha com aspas duplas', () => {
    assert.equal(lerEtiqueta(`<meta name="${META_NAME}" content="rx_abc">`), 'rx_abc')
  })

  test('acha com aspas simples e atributos em ordem trocada — tema real faz as duas coisas', () => {
    assert.equal(lerEtiqueta(`<meta content='rx_abc' name='${META_NAME}'>`), 'rx_abc')
  })

  test('ignora outras meta tags', () => {
    const html = `<meta name="description" content="loja"><meta name="${META_NAME}" content="rx_certo">`
    assert.equal(lerEtiqueta(html), 'rx_certo')
  })

  test('sem a etiqueta, devolve null — e não string vazia, que confundiria com etiqueta vazia', () => {
    assert.equal(lerEtiqueta('<html><head><meta name="viewport" content="x"></head></html>'), null)
  })
})

describe('verificação contra loja de verdade', { concurrency: false }, () => {
  test('etiqueta certa: verificado', async () => {
    const provisorio = await subirLoja({})
    const token = tokenPara(new URL(provisorio.url).hostname, SEGREDO)
    await provisorio.close()

    const loja = await subirLoja({ etiqueta: token })
    try {
      const r = await verificarTitularidade(loja.url, fetchar(), SEGREDO)
      assert.equal(r.verificado, true, JSON.stringify(r))
    } finally {
      await loja.close()
    }
  })

  test('sem etiqueta: ausente, e devolve o token para a pessoa copiar', async () => {
    const loja = await subirLoja({})
    try {
      const r = await verificarTitularidade(loja.url, fetchar(), SEGREDO)
      assert.equal(r.verificado, false)
      if (r.verificado) return
      assert.equal(r.motivo, 'ausente')
      assert.ok(r.token.startsWith('rx_'), 'sem o token na resposta, a tela não tem o que mostrar')
    } finally {
      await loja.close()
    }
  })

  test('etiqueta de OUTRA loja não vale: senão a primeira verificada vira chave-mestra', async () => {
    const loja = await subirLoja({ etiqueta: tokenPara('outraloja.com.br', SEGREDO) })
    try {
      const r = await verificarTitularidade(loja.url, fetchar(), SEGREDO)
      assert.equal(r.verificado, false)
      if (!r.verificado) assert.equal(r.motivo, 'divergente')
    } finally {
      await loja.close()
    }
  })

  test('home que não abre: inacessível, e o motivo diz o status', async () => {
    const loja = await subirLoja({ status: 503 })
    try {
      const r = await verificarTitularidade(loja.url, fetchar(), SEGREDO)
      assert.equal(r.verificado, false)
      if (r.verificado) return
      assert.equal(r.motivo, 'inacessivel')
      assert.match(r.detalhe, /503/)
    } finally {
      await loja.close()
    }
  })

  test('robots que proíbe a própria home: não vira exceção por alguém dizer que é dono', async () => {
    /* §2.3: a exceção de titularidade libera as ETAPAS da jornada, não a
       política inteira. Uma loja que proíbe a leitura da home continua
       proibindo, e a verificação diz isso em vez de ler assim mesmo. */
    const provisorio = await subirLoja({})
    const token = tokenPara(new URL(provisorio.url).hostname, SEGREDO)
    await provisorio.close()

    const loja = await subirLoja({ etiqueta: token, robotsProibeHome: true })
    try {
      const r = await verificarTitularidade(loja.url, fetchar(), SEGREDO)
      assert.equal(r.verificado, false, 'leu a home mesmo com o robots proibindo')
      if (!r.verificado) assert.equal(r.motivo, 'inacessivel')
    } finally {
      await loja.close()
    }
  })
})
