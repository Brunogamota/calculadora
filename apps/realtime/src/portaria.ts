/**
 * Quem pode entrar, e quantos ao mesmo tempo.
 *
 * Existe porque o motor vai sair do localhost. Enquanto ele rodava na máquina
 * do dono, o `running` do servidor apenas CONTAVA auditorias — não segurava
 * nenhuma. Cada POST sobe um Chromium, e medido aqui cada auditoria custa
 * ~118 MB: numa máquina de 1 GB, a sexta simultânea derruba as cinco que já
 * estavam rodando junto com ela.
 *
 * Cair não é o pior. O pior é cair no meio da auditoria de alguém que estava
 * assistindo — a tela ao vivo é o produto, e ela morrer é a única falha que o
 * lead vê inteira.
 *
 * Por isso a recusa é EXPLÍCITA e diz quando voltar. Fila cheia é fato sobre
 * nós, nunca sobre a loja de quem pediu.
 */

/** Teto de auditorias ao mesmo tempo. Cada uma sobe um navegador. */
export function maxSimultaneas(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env['RAIO_X_MAX_SIMULTANEAS'])
  /* 3 é a margem sobre os ~118 MB medidos numa máquina de 1 GB, deixando o
     restante para o Node, o sistema e o pico de uma página pesada. */
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 3
}

/** Quantas auditorias um mesmo endereço pode pedir dentro da janela. */
export function tetoPorIp(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env['RAIO_X_TETO_POR_IP'])
  return Number.isFinite(valor) && valor > 0 ? Math.floor(valor) : 5
}

export function janelaPorIpMs(env: NodeJS.ProcessEnv = process.env): number {
  const valor = Number(env['RAIO_X_JANELA_POR_IP_MINUTOS'])
  const minutos = Number.isFinite(valor) && valor > 0 ? valor : 10
  return minutos * 60_000
}

export interface Portaria {
  /** Motivo da recusa em português de lojista, ou null quando pode entrar. */
  recusa(ip: string, simultaneas: number, agora?: number): string | null
  /** Registra a entrada. Só chame depois de `recusa` devolver null. */
  registra(ip: string, agora?: number): void
  /** Para teste e para o /health: quantos endereços estão na janela. */
  tamanho(): number
}

export function criarPortaria(env: NodeJS.ProcessEnv = process.env): Portaria {
  const teto = maxSimultaneas(env)
  const porIp = tetoPorIp(env)
  const janela = janelaPorIpMs(env)
  /* Em memória e por instância, de propósito: é uma máquina só nesta fase, e a
     alternativa (Redis) é a mesma troca que a §3 já prevê para o barramento.
     Trazer Redis por causa disto seria pagar infraestrutura antes da hora. */
  const pedidos = new Map<string, number[]>()

  const limpar = (agora: number): void => {
    for (const [ip, marcas] of pedidos) {
      const vivas = marcas.filter((m) => agora - m < janela)
      if (vivas.length === 0) pedidos.delete(ip)
      else pedidos.set(ip, vivas)
    }
  }

  return {
    recusa(ip, simultaneas, agora = Date.now()) {
      if (simultaneas >= teto) {
        return (
          `estamos com ${simultaneas} auditorias rodando ao mesmo tempo, que é o nosso limite ` +
          'agora. Tente de novo em um minuto — isso é limitação nossa, não da sua loja.'
        )
      }
      limpar(agora)
      const marcas = pedidos.get(ip) ?? []
      if (marcas.length >= porIp) {
        const maisAntiga = Math.min(...marcas)
        const faltam = Math.ceil((janela - (agora - maisAntiga)) / 60_000)
        return (
          `você já pediu ${marcas.length} auditorias nos últimos ${Math.round(janela / 60_000)} minutos. ` +
          `Espere ${faltam} minuto(s) — o limite existe para a fila não encher para os outros.`
        )
      }
      return null
    },
    registra(ip, agora = Date.now()) {
      const marcas = pedidos.get(ip) ?? []
      marcas.push(agora)
      pedidos.set(ip, marcas)
    },
    tamanho() {
      return pedidos.size
    },
  }
}

/**
 * O endereço de quem pediu, atrás do proxy da hospedagem.
 *
 * `socket.remoteAddress` na Fly é sempre o proxy dela, igual para todo mundo —
 * usar aquilo faria o limite por IP virar um limite global, e o primeiro
 * visitante trancaria a porta para os demais. O `fly-client-ip` é o cabeçalho
 * que a própria Fly injeta; `x-forwarded-for` cobre outras hospedagens.
 *
 * Cabeçalho é dado de fora e pode ser forjado — mas o que se ganha forjando
 * aqui é só escapar do próprio limite, e para isso já bastaria trocar de rede.
 * O teto de simultâneas, que é o que protege a máquina, não depende disto.
 */
export function ipDoPedido(headers: NodeJS.Dict<string | string[]>): string {
  const flyIp = headers['fly-client-ip']
  if (typeof flyIp === 'string' && flyIp.length > 0) return flyIp
  const encaminhado = headers['x-forwarded-for']
  const bruto = Array.isArray(encaminhado) ? encaminhado[0] : encaminhado
  if (typeof bruto === 'string' && bruto.length > 0) {
    const primeiro = bruto.split(',')[0]?.trim()
    if (primeiro) return primeiro
  }
  return 'desconhecido'
}
