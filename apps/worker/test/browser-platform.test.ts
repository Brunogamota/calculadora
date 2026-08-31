/**
 * A checagem de DISPLAY só faz sentido no Linux.
 *
 * `DISPLAY` é conceito do X11. No macOS e no Windows ele não existe, e o
 * Chromium abre janela normalmente. Checar em qualquer plataforma reprovava o
 * Mac por engano — justamente onde o modo headed funciona melhor, e onde a
 * pessoa consegue de fato assistir à jornada (§19).
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../src/lib/browser.ts', import.meta.url), 'utf8')

describe('guarda de DISPLAY', () => {
  test('só dispara no Linux', () => {
    assert.match(
      source,
      /headed && process\.platform === 'linux' && !process\.env\['DISPLAY'\]/,
      'a checagem precisa estar restrita ao Linux',
    )
  })

  test('a mensagem menciona as duas saídas do Linux sem tela', () => {
    assert.match(source, /--headless/)
    assert.match(source, /xvfb-run/)
  })

  test('e diz que em macOS não é necessário', () => {
    assert.match(source, /macOS/)
  })
})
