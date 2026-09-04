/**
 * O intervalo mínimo entre navegações de saída — não confirmado como a causa
 * real do que travou na cobertura (ver `lib/ritmo.ts`), instalado como
 * proteção mesmo assim. Testa só a mecânica de escalonamento: quem chega
 * junto espera sua vez, quem chega depois do intervalo não espera nada.
 *
 * Valores pequenos de propósito — a suíte não precisa gastar segundos de
 * verdade pra provar que a matemática do escalonamento está certa.
 */

import { test, describe } from 'node:test'
import assert from 'node:assert/strict'
import { criarRitmoDeSaida, intervaloMsConfigurado } from '../src/lib/ritmo.ts'

describe('quanto tempo esperar', () => {
  test('sem a variável de ambiente, intervalo é zero', () => {
    assert.equal(intervaloMsConfigurado({}), 0)
  })

  test('variável inválida também cai pra zero — não trava por engano', () => {
    assert.equal(intervaloMsConfigurado({ RAIO_X_RITMO_SAIDA_MS: 'abacate' }), 0)
  })

  test('variável negativa cai pra zero — negativo não faz sentido como intervalo', () => {
    assert.equal(intervaloMsConfigurado({ RAIO_X_RITMO_SAIDA_MS: '-500' }), 0)
  })

  test('variável válida é respeitada', () => {
    assert.equal(intervaloMsConfigurado({ RAIO_X_RITMO_SAIDA_MS: '2000' }), 2000)
  })
})

describe('escalonamento', () => {
  test('intervalo zero: nunca espera, não importa quantas chamadas', async () => {
    const ritmo = criarRitmoDeSaida({})
    const t0 = Date.now()
    await Promise.all([ritmo.aguardar(), ritmo.aguardar(), ritmo.aguardar()])
    assert.ok(Date.now() - t0 < 20, 'esperou algo com intervalo configurado como zero')
  })

  test('duas chamadas na mesma hora: a segunda espera o intervalo inteiro', async () => {
    const ritmo = criarRitmoDeSaida({ RAIO_X_RITMO_SAIDA_MS: '40' })
    const t0 = 1_000_000
    // A primeira não espera nada — não havia ninguém antes dela.
    await ritmo.aguardar(t0)
    const t1 = Date.now()
    // A segunda, pedida "no mesmo instante" t0, precisa esperar os 40ms.
    await ritmo.aguardar(t0)
    const esperou = Date.now() - t1
    assert.ok(esperou >= 35, `esperou só ${esperou}ms, esperava perto de 40ms`)
  })

  test('chamada depois que o intervalo já passou não espera nada', async () => {
    const ritmo = criarRitmoDeSaida({ RAIO_X_RITMO_SAIDA_MS: '40' })
    const t0 = 1_000_000
    await ritmo.aguardar(t0)
    const t1 = Date.now()
    // 100ms de relógio "simulado" depois — bem além dos 40ms configurados.
    await ritmo.aguardar(t0 + 100)
    assert.ok(Date.now() - t1 < 15, 'esperou mesmo o intervalo já tendo passado')
  })

  test('três chamadas concorrentes escalonam em fila, não pisam uma na outra', async () => {
    /* A reserva da vez é síncrona (ler e escrever `proximoLivre` sem await no
       meio) — é isso que garante que três chamadas disparadas juntas não
       leiam todas o mesmo "não tem ninguém antes de mim" e saiam sem esperar
       nenhuma. Este teste prova o efeito, não o mecanismo interno. */
    const ritmo = criarRitmoDeSaida({ RAIO_X_RITMO_SAIDA_MS: '30' })
    const t0 = Date.now()
    const termini: number[] = []
    await Promise.all(
      [1, 2, 3].map(async () => {
        await ritmo.aguardar()
        termini.push(Date.now() - t0)
      }),
    )
    termini.sort((a, b) => a - b)
    // A primeira sai quase na hora; a segunda e a terceira ficam ~30ms atrás
    // uma da outra — nenhuma das três sai junto com outra.
    assert.ok(termini[1]! - termini[0]! >= 20, `intervalo entre 1ª e 2ª foi só ${termini[1]! - termini[0]!}ms`)
    assert.ok(termini[2]! - termini[1]! >= 20, `intervalo entre 2ª e 3ª foi só ${termini[2]! - termini[1]!}ms`)
  })
})
