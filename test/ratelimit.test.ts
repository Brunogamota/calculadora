import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { HostRateLimiter } from '../src/lib/ratelimit.ts'

describe('HostRateLimiter — §2.3 1 req/s por domínio', () => {
  test('espaça requisições do mesmo host', async () => {
    const limiter = new HostRateLimiter(120)
    const starts: number[] = []
    const task = () => limiter.schedule('loja.com.br', async () => { starts.push(Date.now()) })
    await Promise.all([task(), task(), task()])

    assert.equal(starts.length, 3)
    const s = starts as number[]
    assert.ok((s[1]! - s[0]!) >= 110, `gap 1: ${s[1]! - s[0]!}ms`)
    assert.ok((s[2]! - s[1]!) >= 110, `gap 2: ${s[2]! - s[1]!}ms`)
  })

  test('hosts diferentes não se bloqueiam', async () => {
    const limiter = new HostRateLimiter(300)
    const t0 = Date.now()
    await Promise.all([
      limiter.schedule('a.com', async () => {}),
      limiter.schedule('b.com', async () => {}),
      limiter.schedule('c.com', async () => {}),
    ])
    assert.ok(Date.now() - t0 < 250, 'hosts distintos devem rodar em paralelo')
  })

  test('erro em uma requisição não trava o host', async () => {
    const limiter = new HostRateLimiter(50)
    await assert.rejects(limiter.schedule('loja.com', async () => { throw new Error('boom') }))
    const value = await limiter.schedule('loja.com', async () => 'ok')
    assert.equal(value, 'ok')
  })

  test('Crawl-delay maior é respeitado; menor é ignorado', () => {
    const limiter = new HostRateLimiter(1000)
    limiter.setMinInterval('lenta.com', 5000)
    assert.equal(limiter.getMinInterval('lenta.com'), 5000)
    limiter.setMinInterval('rapida.com', 200)
    assert.equal(limiter.getMinInterval('rapida.com'), 1000)
  })

  test('host é case-insensitive', async () => {
    const limiter = new HostRateLimiter(150)
    const starts: number[] = []
    await Promise.all([
      limiter.schedule('Loja.com', async () => { starts.push(Date.now()) }),
      limiter.schedule('loja.com', async () => { starts.push(Date.now()) }),
    ])
    assert.ok((starts[1]! - starts[0]!) >= 140, 'mesmo host em caixas diferentes deve ser serializado')
  })
})
