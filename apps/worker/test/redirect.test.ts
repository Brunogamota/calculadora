import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { resolveRedirectTarget } from '../src/lib/http.ts'
import { AuditError } from '../src/lib/errors.ts'

function code(current: string, location: string): string {
  try {
    resolveRedirectTarget(current, location)
    return 'NO_ERROR'
  } catch (e) {
    return e instanceof AuditError ? e.code : 'UNKNOWN'
  }
}

describe('resolveRedirectTarget — §6.1 revalidar cada hop', () => {
  test('resolve Location relativo contra a URL atual', () => {
    const r = resolveRedirectTarget('https://loja.com.br/a/b', '/pt-br')
    assert.equal(r.href, 'https://loja.com.br/pt-br')
  })

  test('resolve Location relativo sem barra inicial', () => {
    const r = resolveRedirectTarget('https://loja.com.br/a/b', 'c')
    assert.equal(r.href, 'https://loja.com.br/a/c')
  })

  test('aceita redirect para outro domínio público', () => {
    const r = resolveRedirectTarget('https://loja.com.br/', 'https://www.loja.com.br/')
    assert.equal(r.hostname, 'www.loja.com.br')
  })

  test('mata redirect para loopback', () => {
    assert.equal(code('https://loja.com.br/', 'http://127.0.0.1/admin'), 'IP_LITERAL')
    assert.equal(code('https://loja.com.br/', 'http://[::1]/'), 'IP_LITERAL')
  })

  test('mata redirect para metadata de cloud', () => {
    assert.equal(code('https://loja.com.br/', 'http://169.254.169.254/latest/meta-data/'), 'IP_LITERAL')
  })

  test('mata redirect para faixa privada e para localhost', () => {
    assert.equal(code('https://loja.com.br/', 'http://192.168.0.1/'), 'IP_LITERAL')
    assert.equal(code('https://loja.com.br/', 'http://localhost:80/'), 'BLOCKED_HOSTNAME')
    assert.equal(code('https://loja.com.br/', 'http://algo.internal/'), 'BLOCKED_HOSTNAME')
  })

  test('mata troca de esquema para file/javascript', () => {
    assert.equal(code('https://loja.com.br/', 'file:///etc/passwd'), 'BAD_SCHEME')
    assert.equal(code('https://loja.com.br/', 'javascript:alert(1)'), 'BAD_SCHEME')
  })

  test('mata redirect para porta interna', () => {
    assert.equal(code('https://loja.com.br/', 'http://loja.com.br:6379/'), 'PORT_NOT_ALLOWED')
  })

  test('mata credencial injetada via redirect', () => {
    assert.equal(code('https://loja.com.br/', 'https://a:b@loja.com.br/'), 'HAS_CREDENTIALS')
  })
})
