import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeUrl, assertUrlShapeIsSafe } from '../src/lib/guards.ts'
import { classifyAddress } from '../src/lib/ipranges.ts'
import { AuditError } from '../src/lib/errors.ts'

function shapeError(input: string): string {
  try {
    assertUrlShapeIsSafe(normalizeUrl(input))
    return 'NO_ERROR'
  } catch (e) {
    return e instanceof AuditError ? e.code : 'UNKNOWN'
  }
}

describe('normalizeUrl — §6.1 aceitar com ou sem protocolo, com ou sem www', () => {
  test('assume https quando falta o esquema', () => {
    const r = normalizeUrl('loja.com.br')
    assert.equal(r.href, 'https://loja.com.br/')
    assert.equal(r.schemeAssumed, true)
  })

  test('preserva www, path e query', () => {
    const r = normalizeUrl('https://www.loja.com.br/produtos?x=1')
    assert.equal(r.href, 'https://www.loja.com.br/produtos?x=1')
    assert.equal(r.hostname, 'www.loja.com.br')
    assert.equal(r.schemeAssumed, false)
  })

  test('aceita http explícito sem promover para https', () => {
    assert.equal(normalizeUrl('http://loja.com.br').protocol, 'http:')
  })

  test('remove fragmento e espaços em volta', () => {
    assert.equal(normalizeUrl('  loja.com.br/p#topo  ').href, 'https://loja.com.br/p')
  })

  test('remove ponto final do hostname', () => {
    assert.equal(normalizeUrl('https://loja.com.br./x').hostname, 'loja.com.br')
  })

  test('rejeita entrada vazia', () => {
    assert.equal(shapeError('   '), 'EMPTY_INPUT')
  })

  test('rejeita esquema não-http', () => {
    for (const u of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://loja.com.br', 'data:text/html,x']) {
      assert.equal(shapeError(u), 'BAD_SCHEME', u)
    }
  })

  test('rejeita credencial embutida', () => {
    assert.equal(shapeError('https://user:pass@loja.com.br'), 'HAS_CREDENTIALS')
  })

  test('rejeita porta fora de 80/443', () => {
    assert.equal(shapeError('http://loja.com.br:8080'), 'PORT_NOT_ALLOWED')
    assert.equal(shapeError('http://loja.com.br:22'), 'PORT_NOT_ALLOWED')
    assert.equal(shapeError('https://loja.com.br:443'), 'NO_ERROR')
  })
})

describe('SSRF §2.5 — formas de IP direto', () => {
  test('rejeita IPv4 pontuado', () => {
    assert.equal(shapeError('http://127.0.0.1'), 'IP_LITERAL')
    assert.equal(shapeError('http://192.168.0.1'), 'IP_LITERAL')
    assert.equal(shapeError('https://8.8.8.8'), 'IP_LITERAL')
  })

  test('rejeita IPv4 em decimal, octal e hexadecimal', () => {
    // new URL normaliza essas formas para 127.0.0.1
    assert.equal(shapeError('http://2130706433'), 'IP_LITERAL')
    assert.equal(shapeError('http://0x7f000001'), 'IP_LITERAL')
    assert.equal(shapeError('http://017700000001'), 'IP_LITERAL')
    assert.equal(shapeError('http://127.1'), 'IP_LITERAL')
  })

  test('rejeita IPv6 entre colchetes', () => {
    assert.equal(shapeError('http://[::1]'), 'IP_LITERAL')
    assert.equal(shapeError('http://[fe80::1]'), 'IP_LITERAL')
    assert.equal(shapeError('http://[::ffff:127.0.0.1]'), 'IP_LITERAL')
  })

  test('rejeita hostname reservado', () => {
    for (const u of ['localhost', 'http://localhost', 'app.local', 'x.internal', 'a.home.arpa', 'foo.onion']) {
      assert.equal(shapeError(u), 'BLOCKED_HOSTNAME', u)
    }
  })

  test('rejeita rótulo único (intranet)', () => {
    assert.equal(shapeError('http://intranet'), 'SINGLE_LABEL_HOST')
  })

  test('deixa passar domínio público comum', () => {
    for (const u of ['loja.com.br', 'https://www.loja.com.br/a/b', 'sub.dominio.shop']) {
      assert.equal(shapeError(u), 'NO_ERROR', u)
    }
  })
})

describe('classifyAddress — faixas', () => {
  const blocked = [
    '0.0.0.0', '10.1.2.3', '100.64.0.1', '127.0.0.1', '169.254.169.254',
    '172.16.0.1', '172.31.255.254', '192.0.0.1', '192.0.2.5', '192.168.1.1',
    '198.18.0.1', '198.51.100.9', '203.0.113.9', '224.0.0.1', '240.0.0.1', '255.255.255.255',
    '::', '::1', 'fe80::1', 'fc00::1', 'fd12:3456::1', 'ff02::1',
    '::ffff:127.0.0.1', '::ffff:10.0.0.1', '64:ff9b::192.168.0.1', '2001:db8::1', '100::1',
  ]
  for (const ip of blocked) {
    test(`bloqueia ${ip}`, () => {
      const v = classifyAddress(ip)
      assert.equal(v.isPublic, false, `${ip} deveria ser bloqueado`)
      assert.ok(v.blockedBy, `${ip} precisa dizer qual faixa barrou`)
    })
  }

  const allowed = ['8.8.8.8', '1.1.1.1', '23.227.38.65', '2001:4860:4860::8888', '2600::1']
  for (const ip of allowed) {
    test(`libera ${ip}`, () => {
      assert.equal(classifyAddress(ip).isPublic, true, `${ip} deveria passar`)
    })
  }

  test('lixo não vira endereço público', () => {
    assert.equal(classifyAddress('nao-e-ip').isPublic, false)
    assert.equal(classifyAddress('999.1.1.1').isPublic, false)
  })

  test('172.15 e 172.32 são públicos (borda do /12)', () => {
    assert.equal(classifyAddress('172.15.0.1').isPublic, true)
    assert.equal(classifyAddress('172.32.0.1').isPublic, true)
    assert.equal(classifyAddress('172.16.0.1').isPublic, false)
    assert.equal(classifyAddress('172.31.0.1').isPublic, false)
  })

  test('100.63 e 100.128 são públicos (borda do CGNAT /10)', () => {
    assert.equal(classifyAddress('100.63.255.255').isPublic, true)
    assert.equal(classifyAddress('100.128.0.0').isPublic, true)
    assert.equal(classifyAddress('100.64.0.0').isPublic, false)
    assert.equal(classifyAddress('100.127.255.255').isPublic, false)
  })
})

describe('AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS — a única brecha, e ela é fechada por padrão', () => {
  test('sem a variável, localhost e 127.0.0.1 continuam barrados', () => {
    delete process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS']
    assert.equal(shapeError('http://127.0.0.1:8080'), 'PORT_NOT_ALLOWED')
    assert.equal(shapeError('http://127.0.0.1'), 'IP_LITERAL')
    assert.equal(shapeError('localhost'), 'BLOCKED_HOSTNAME')
  })

  test('valor diferente de "1" não abre a brecha', () => {
    process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = 'true'
    assert.equal(shapeError('http://127.0.0.1'), 'IP_LITERAL')
    delete process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS']
  })

  test('com a variável, só o alvo local passa — o resto do guard continua de pé', () => {
    process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS'] = '1'
    assert.equal(shapeError('http://127.0.0.1:4000'), 'NO_ERROR')
    // Faixas privadas que NÃO são o alvo local seguem barradas.
    assert.equal(shapeError('http://169.254.169.254'), 'IP_LITERAL')
    assert.equal(shapeError('http://192.168.0.1'), 'IP_LITERAL')
    assert.equal(shapeError('http://10.0.0.1'), 'IP_LITERAL')
    delete process.env['AUDIT_ALLOW_LOCAL_TARGETS_FOR_TESTS']
  })
})
