/**
 * Intervalo mínimo entre uma navegação de saída e a próxima — do PROCESSO
 * inteiro, não por domínio.
 *
 * Existe por causa de um padrão visto medindo cobertura contra 227 lojas
 * reais: `gymshark.com`, `everlane.com` e `brooklinen.com` carregaram limpo
 * num teste isolado (poucos pedidos, logo após um deploy) e travaram 30s+
 * quando fizeram parte de uma rajada de 227 auditorias sequenciais, do mesmo
 * IP, em ~2h. A explicação mais provável é reputação de IP por RITMO de
 * pedidos — comum em CDN grande, que pontua a origem pela velocidade dos
 * pedidos, não só pelo destino.
 *
 * IMPORTANTE: essa explicação NÃO foi confirmada por experimento controlado.
 * O dono do projeto decidiu não gastar mais uma rodada de investigação nisso
 * agora e pediu a proteção assim mesmo — então isto é seguro, não prova. O
 * valor do intervalo é um palpite conservador, não um número medido: se a
 * janela real de reputação for maior que isto, esta proteção sozinha não
 * resolve, e a investigação em `diagnosticar-espacamento.ts` continua sendo
 * o caminho pra saber ao certo.
 *
 * Desligado por padrão (intervalo 0 quando a variável não está definida):
 * um teste que sobe a loja falsa várias vezes numa suíte não deveria pagar
 * segundos de espera por uma proteção que só faz sentido contra loja real.
 * Ligado no Dockerfile — ver `RAIO_X_RITMO_SAIDA_MS` lá — do mesmo jeito que
 * `RAIO_X_AQUECER`.
 *
 * Uso normal (um usuário, uma auditoria, sozinha) não sente isto: só pesa
 * quando MAIS de uma navegação de saída começaria ao mesmo tempo.
 */

export interface RitmoDeSaida {
  /** Espera até que seja a vez desta chamada. Resolve na hora se já é. */
  aguardar(agora?: number): Promise<void>
}

export function intervaloMsConfigurado(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env['RAIO_X_RITMO_SAIDA_MS'])
  return Number.isFinite(valor) && valor >= 0 ? valor : 0
}

/**
 * Fila por reserva: cada chamada marca sua vez SÍNCRONAMENTE (sem `await`
 * entre ler e escrever `proximoLivre`, então chamadas concorrentes não pisam
 * uma na outra) e só depois espera até a vez chegar. Isso escalona quem
 * chega junto em vez de deixar todo mundo repetir a mesma leitura de
 * "última vez" e não esperar nada.
 */
export function criarRitmoDeSaida(env: NodeJS.ProcessEnv = process.env): RitmoDeSaida {
  const intervaloMs = intervaloMsConfigurado(env)
  let proximoLivre = 0

  return {
    async aguardar(agora = Date.now()) {
      if (intervaloMs <= 0) return
      const minhaVez = Math.max(agora, proximoLivre)
      proximoLivre = minhaVez + intervaloMs
      const faltam = minhaVez - agora
      if (faltam > 0) await new Promise((resolve) => setTimeout(resolve, faltam))
    },
  }
}

/**
 * Uma instância por processo — é o processo que tem reputação de IP com o
 * mundo de fora, não a auditoria individual. `createDeps()` é fresco por
 * auditoria de propósito (§ orçamento); isto aqui é o contrário de propósito.
 */
export const ritmoDeSaidaGlobal: RitmoDeSaida = criarRitmoDeSaida()
