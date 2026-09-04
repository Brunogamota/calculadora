/**
 * Antes de aceitar "4 de 227 entraram" como o número real, uma coisa nos
 * dados pede investigação: mais de 100 dos 227 candidatos morreram com o
 * MESMO sintoma —
 *
 *   NETWORK_ERROR: page.goto: Timeout 30000ms exceeded.
 *
 * — em ~30 a 38 segundos, cruzando BR e internacional, e batendo em marca que
 * está inequivocamente no ar (gymshark.com, everlane.com, rothys.com,
 * brooklinen.com — não é hipótese, são lojas grandes, com tráfego real, que
 * qualquer navegador comum abre na hora). Não é plausível que mais de cem
 * lojas independentes estejam todas fora do ar ao mesmo tempo. É o padrão
 * clássico de defeito em camada BAIXA e compartilhada (Kepner-Tregoe: falha
 * em quase TODOS os casos, não em alguns) — o suspeito é a rede de saída da
 * máquina, não a página de cada loja.
 *
 * Este script testa exatamente essa camada, sem Chromium no meio: conexão
 * TCP+TLS crua, forçando IPv4 e IPv6 separadamente, contra uma amostra dos
 * domínios que travaram. Se o `-4` for rápido e o `-6` travar nos mesmos ~30s,
 * a causa é a rota IPv6 de saída da Fly — e a correção é forçar IPv4 no
 * Node/Chromium, não mexer em jornada nenhuma. Se os DOIS travarem, o suspeito
 * muda: DNS da máquina, ou bloqueio genérico do IP da Fly por proteção
 * anti-bot que reconhece faixa de datacenter — outra investigação, não esta.
 *
 *   fly ssh console -a raio-x-motor -C "npm run diagnosticar-rede"
 *
 * Roda em segundos, não em minutos: é conexão crua, sem carregar página
 * nenhuma. Repetir não fere §2.2 — não é auditoria, é uma checagem de rede
 * mais leve que um `curl`.
 */

import { connect as connectSocket } from 'node:net'
import { connect as connectTls } from 'node:tls'
import dns from 'node:dns/promises'

/**
 * Amostra dos que travaram nesta rodada — marca grande, definitivamente no
 * ar, cruzando as duas origens. Não é a lista inteira de propósito: o que
 * este script decide é "existe padrão de camada baixa?", e uma dúzia já
 * responde isso.
 */
const AMOSTRA = [
  'gymshark.com',
  'everlane.com',
  'rothys.com',
  'brooklinen.com',
  'alo.com',
  'fearofgod.com',
  'ironstudios.com.br',
  'ekomat.com.br',
  'coffeemais.com',
  'amaro.com',
] as const

const TIMEOUT_MS = 10_000

interface Tentativa {
  family: 4 | 6
  endereco: string | null
  ms: number
  erro: string | null
}

async function conectar(host: string, endereco: string, family: 4 | 6): Promise<Tentativa> {
  const t0 = Date.now()
  return new Promise((resolve) => {
    const socket = connectSocket({ host: endereco, port: 443, family, timeout: TIMEOUT_MS })
    /* O tempo decorrido vai JUNTO com o erro, não só com o sucesso — sem isto
       um erro instantâneo (família não suportada NESTA máquina, recusa rápida
       de verdade) e um travamento de 10s pareciam a mesma coisa no relatório:
       os dois viravam `ms: null`. Foi exatamente esse buraco que me fez ler
       "sem IPv6 na rede daqui" como "IPv6 trava" na primeira rodada. */
    const terminar = (erro: string | null): void => {
      socket.destroy()
      resolve({ family, endereco, ms: Date.now() - t0, erro })
    }
    socket.once('connect', () => {
      // TCP deu — agora o TLS, que é o que trava quando é WAF/anti-bot
      // reconhecendo a faixa de IP e segurando a mão em vez de recusar rápido.
      const tls = connectTls({ socket, servername: host, timeout: TIMEOUT_MS })
      tls.once('secureConnect', () => terminar(null))
      tls.once('error', (e) => terminar(`TLS: ${e.message}`))
      tls.once('timeout', () => terminar(`TLS travou (>${TIMEOUT_MS}ms)`))
    })
    socket.once('error', (e) => terminar(`TCP: ${e.message}`))
    socket.once('timeout', () => terminar(`TCP travou (>${TIMEOUT_MS}ms)`))
  })
}

function linha(...cols: string[]): void {
  console.log('  ' + cols.join('  '))
}

async function main(): Promise<void> {
  console.log('')
  console.log('conexão TCP+TLS crua, IPv4 e IPv6 separados, sem Chromium — 443, sem carregar página')
  console.log('')

  let ipv4TodasRapidas = true
  let ipv6AlgumaTravou = false
  let ipv4TambemTravou = false

  for (const host of AMOSTRA) {
    let enderecos: Array<{ address: string; family: number }>
    try {
      enderecos = await dns.lookup(host, { all: true, verbatim: true })
    } catch (e) {
      linha(host.padEnd(24), `DNS falhou: ${e instanceof Error ? e.message : String(e)}`)
      continue
    }
    const v4 = enderecos.find((e) => e.family === 4)?.address ?? null
    const v6 = enderecos.find((e) => e.family === 6)?.address ?? null

    const r4 = v4 ? await conectar(host, v4, 4) : null
    const r6 = v6 ? await conectar(host, v6, 6) : null

    /* Perto do TIMEOUT_MS = travou de verdade. Longe dele com erro = recusa
       rápida (família não suportada aqui, conexão recusada) — não é a mesma
       evidência, e tratar como igual foi o bug da primeira versão. */
    const travou = (r: Tentativa | null): boolean => r !== null && r.erro !== null && r.ms > TIMEOUT_MS * 0.8
    const fmt = (r: Tentativa | null, semRegistro: string): string => {
      if (r === null) return semRegistro
      return r.erro === null ? `${r.ms}ms` : `${r.erro} (${r.ms}ms)`
    }
    linha(host.padEnd(24), `v4 ${fmt(r4, 'sem A').padEnd(28)}`, `v6 ${fmt(r6, 'sem AAAA')}`)

    if (r4 === null || travou(r4) || (r4.erro !== null && r4.ms > 5000)) ipv4TodasRapidas = false
    if (r4 !== null && r4.erro === null && r4.ms < 5000 && travou(r6)) ipv6AlgumaTravou = true
    if (r4 !== null && travou(r4)) ipv4TambemTravou = true
  }

  console.log('')
  console.log('VEREDITO')
  if (ipv6AlgumaTravou && ipv4TodasRapidas) {
    console.log('  IPv6 é o suspeito confirmado: v4 rápido, v6 travando no mesmo alvo.')
    console.log('  O Chromium (e o Node) tentam as duas famílias e podem esperar a que trava')
    console.log('  antes de desistir — isso bate com os ~30-38s vistos na cobertura. Correção:')
    console.log('  forçar IPv4 na saída (launchBrowser com --host-resolver-rules, ou dns.setDefaultResultOrder')
    console.log("  ('ipv4first') antes de qualquer coisa que resolva nome nesta máquina).")
  } else if (ipv4TambemTravou) {
    console.log('  IPv4 TAMBÉM travou em alvo que está inequivocamente no ar. Não é rota IPv6:')
    console.log('  o suspeito passa a ser bloqueio genérico do IP de saída da Fly por proteção')
    console.log('  anti-bot que reconhece faixa de datacenter, ou DNS da própria máquina.')
    console.log('  Próximo passo: mesma amostra, de uma máquina fora da Fly, pra comparar.')
  } else {
    console.log('  IPv4 e IPv6 saíram rápidos nesta amostra. O padrão da cobertura não se repetiu')
    console.log('  aqui — pode ser intermitente (medir de novo antes de descartar) ou específico')
    console.log('  do Chromium/Playwright, não da rede crua (comparar com `npm run smoke` contra')
    console.log('  um destes domínios).')
  }
  console.log('')
}

await main()
