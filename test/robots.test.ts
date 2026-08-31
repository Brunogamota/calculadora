import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { parseRobots, evaluateRules } from '../src/lib/robots.ts'

const UA = 'reborncheckoutaudit'

function allows(txt: string, path: string, ua = UA): boolean {
  return evaluateRules(parseRobots(txt, ua).rules, path)
}

describe('parseRobots — seleção de grupo', () => {
  test('grupo específico ganha do curinga', () => {
    const txt = `
User-agent: *
Disallow: /

User-agent: RebornCheckoutAudit
Disallow: /admin
`
    const parsed = parseRobots(txt, UA)
    assert.equal(parsed.matchedAgent, 'reborncheckoutaudit')
    assert.equal(evaluateRules(parsed.rules, '/products.json'), true)
    assert.equal(evaluateRules(parsed.rules, '/admin/x'), false)
  })

  test('cai no curinga quando não há grupo nosso', () => {
    const txt = 'User-agent: *\nDisallow: /checkout\n'
    const parsed = parseRobots(txt, UA)
    assert.equal(parsed.matchedAgent, '*')
    assert.equal(evaluateRules(parsed.rules, '/checkout'), false)
  })

  test('sem grupo aplicável libera tudo', () => {
    const parsed = parseRobots('User-agent: Googlebot\nDisallow: /\n', UA)
    assert.equal(parsed.matchedAgent, null)
    assert.equal(evaluateRules(parsed.rules, '/qualquer'), true)
  })

  test('User-agents consecutivos compartilham as regras', () => {
    const txt = 'User-agent: A\nUser-agent: *\nDisallow: /x\n'
    assert.equal(allows(txt, '/x'), false)
  })

  test('ignora comentários e linhas malformadas', () => {
    const txt = '# comentário\nUser-agent: *  # nosso\nDisallow: /x # nota\nlixo sem dois pontos\n'
    assert.equal(allows(txt, '/x'), false)
    assert.equal(allows(txt, '/y'), true)
  })
})

describe('evaluateRules — precedência', () => {
  test('Disallow vazio libera tudo', () => {
    assert.equal(allows('User-agent: *\nDisallow:\n', '/qualquer'), true)
  })

  test('Disallow: / bloqueia tudo', () => {
    assert.equal(allows('User-agent: *\nDisallow: /\n', '/'), false)
    assert.equal(allows('User-agent: *\nDisallow: /\n', '/products.json'), false)
  })

  test('match mais longo ganha', () => {
    const txt = 'User-agent: *\nDisallow: /p\nAllow: /products\n'
    assert.equal(allows(txt, '/products.json'), true)
    assert.equal(allows(txt, '/pagina'), false)
  })

  test('empate de comprimento vai para Allow', () => {
    const txt = 'User-agent: *\nDisallow: /x\nAllow: /x\n'
    assert.equal(allows(txt, '/x'), true)
  })

  test('curinga * no meio do padrão', () => {
    const txt = 'User-agent: *\nDisallow: /*/checkout\n'
    assert.equal(allows(txt, '/loja/checkout'), false)
    assert.equal(allows(txt, '/checkout'), true)
  })

  test('âncora $ no fim', () => {
    const txt = 'User-agent: *\nDisallow: /*.json$\n'
    assert.equal(allows(txt, '/products.json'), false)
    assert.equal(allows(txt, '/products.json?x=1'), true)
  })

  test('caminho não coberto por regra é liberado', () => {
    assert.equal(allows('User-agent: *\nDisallow: /admin\n', '/products.json'), true)
  })
})

describe('robots real de Shopify (formato típico)', () => {
  // Trecho no formato que o Shopify serve por padrão. Confirmar contra loja real
  // antes de tratar como verdade — aqui só valida o parser, não a loja.
  const shopifyLike = `
User-agent: *
Disallow: /admin
Disallow: /cart
Disallow: /orders
Disallow: /checkouts/
Disallow: /checkout
Disallow: /*/checkouts/
Allow: /products.json
Sitemap: https://loja.com.br/sitemap.xml
`
  test('bloqueia /cart e /checkout', () => {
    assert.equal(allows(shopifyLike, '/cart'), false)
    assert.equal(allows(shopifyLike, '/checkout'), false)
  })
  test('libera home e página de produto', () => {
    assert.equal(allows(shopifyLike, '/'), true)
    assert.equal(allows(shopifyLike, '/products/camiseta'), true)
    assert.equal(allows(shopifyLike, '/products.json'), true)
  })
})
