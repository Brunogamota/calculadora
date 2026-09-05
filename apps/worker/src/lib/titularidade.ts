/**
 * Prova de que quem pediu a auditoria é dono da loja.
 *
 * Existe porque o modo consentido era uma DECLARAÇÃO, não uma prova. Na API,
 * `server.ts` preenchia o aceite sozinho quando o chamador mandava um objeto
 * vazio: bastava `{"url":"lojaalheia.com.br","modo":"consentido","aceite":{}}`
 * para o robô ignorar o robots.txt de uma loja de terceiro e deixar um
 * checkout abandonado no admin de outra pessoa. O endpoint é público.
 *
 * A prova é a mesma que o Google Search Console usa, porque é a que o lojista
 * já sabe dar: uma etiqueta no HTML da home.
 *
 *   <meta name="raio-x-verificacao" content="rx_...">
 *
 * ESCOLHAS, e por quê:
 *
 * **Meta tag, não DNS.** Lojista Shopify quase sempre usa domínio gerenciado
 * pela própria Shopify, então mexer em registro TXT é falar com outro
 * fornecedor. Editar o `theme.liquid` ele faz sozinho, e é o mesmo caminho do
 * Search Console.
 *
 * **Token sem banco.** `HMAC-SHA256(segredo, hostname)`. Não existe banco
 * nesta fase e trazer um por causa disto seria pagar infraestrutura antes da
 * hora. O token não dá para forjar sem o segredo, e é sempre o mesmo para o
 * mesmo domínio — quem deixar a etiqueta no tema não precisa repetir nada na
 * próxima auditoria.
 *
 * **Ligado ao hostname.** Um token válido copiado para outro site não vale
 * nada: o que se compara é o token DAQUELE hostname. Sem isso, a primeira
 * loja verificada viraria uma chave-mestra.
 */

import { createHmac, timingSafeEqual } from 'node:crypto'
import { AuditError } from './errors.ts'
import { fetchRobots } from './robots.ts'
import type { SafeFetch } from './http.ts'
import { normalizeUrl } from './guards.ts'

export const META_NAME = 'raio-x-verificacao'
const PREFIXO = 'rx_'

/**
 * Sem segredo o serviço NÃO SOBE, em vez de cair para um padrão.
 *
 * Um segredo padrão em código seria pior do que não ter verificação nenhuma:
 * daria a aparência de prova para um token que qualquer um deriva lendo o
 * repositório, e uma falha silenciosa dessas só aparece quando alguém já
 * auditou loja alheia com ela.
 */
export function segredoDoAmbiente(env: NodeJS.ProcessEnv = process.env): string {
  const s = env['RAIO_X_SEGREDO_TITULARIDADE']
  if (typeof s !== 'string' || s.trim().length < 16) {
    throw new AuditError(
      'CONFIG_INVALIDA',
      'RAIO_X_SEGREDO_TITULARIDADE ausente ou curto demais (mínimo 16 caracteres). ' +
        'Sem ele o token de titularidade seria adivinhável, então o serviço recusa subir. ' +
        'Gere um com: openssl rand -hex 32',
      { variavel: 'RAIO_X_SEGREDO_TITULARIDADE' },
    )
  }
  return s
}

/** O token que ESTA loja precisa publicar. Estável e específico do hostname. */
export function tokenPara(hostname: string, segredo: string): string {
  const alvo = hostname.trim().toLowerCase().replace(/^www\./, '')
  const mac = createHmac('sha256', segredo).update(alvo).digest('hex')
  return PREFIXO + mac.slice(0, 32)
}

/** Comparação em tempo constante: token é segredo, e `===` vaza por timing. */
function iguais(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  if (x.length !== y.length) return false
  return timingSafeEqual(x, y)
}

/**
 * Lê o `content` da etiqueta no HTML.
 *
 * Regex e não parser de DOM de propósito: aqui não há navegador (a verificação
 * roda ANTES de subir o Chromium, para que uma loja não verificada não custe
 * um navegador) e a etiqueta é uma linha de formato conhecido. O que a regex
 * precisa aguentar é ordem trocada de atributos e aspas simples ou duplas —
 * as duas coisas que um tema real faz.
 */
export function lerEtiqueta(html: string): string | null {
  const tags = html.match(/<meta\b[^>]*>/gi) ?? []
  for (const tag of tags) {
    const nome = /\bname\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]
    if (nome?.trim().toLowerCase() !== META_NAME) continue
    const conteudo = /\bcontent\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1]
    if (conteudo !== undefined) return conteudo.trim()
  }
  return null
}

export type ResultadoTitularidade =
  | { verificado: true; hostname: string; token: string }
  | {
      verificado: false
      hostname: string
      /** O token que a loja PRECISA publicar — vai na tela para ele copiar. */
      token: string
      motivo: 'ausente' | 'divergente' | 'inacessivel'
      detalhe: string
    }

/**
 * Busca a home e procura a etiqueta.
 *
 * O robots é conferido ANTES: uma loja que proíbe a leitura da própria home
 * não vira exceção só porque alguém disse que é dono dela. A exceção de
 * titularidade (§2.3) libera as etapas da jornada, não a política inteira.
 */
export async function verificarTitularidade(
  url: string,
  safeFetch: SafeFetch,
  segredo: string,
): Promise<ResultadoTitularidade> {
  const alvo = normalizeUrl(url)
  const hostname = alvo.hostname
  const token = tokenPara(hostname, segredo)
  const base = { hostname, token } as const

  /* Sempre a home, nunca o caminho que veio na URL: a etiqueta mora no
     `theme.liquid`, que sai em toda página, e pedir a home é o pedido mais
     barato e mais previsível que dá para fazer numa loja. */
  const home = new URL('/', alvo.origin).href

  const policy = await fetchRobots(alvo.origin, safeFetch).catch(() => null)
  if (policy && !policy.isAllowed('/')) {
    return {
      ...base,
      verificado: false,
      motivo: 'inacessivel',
      detalhe: 'o robots.txt desta loja proíbe a leitura da própria home, então não há onde procurar a etiqueta',
    }
  }

  let resposta
  try {
    resposta = await safeFetch(home, { timeoutMs: 15_000 })
  } catch (e) {
    return {
      ...base,
      verificado: false,
      motivo: 'inacessivel',
      detalhe: e instanceof Error ? e.message : 'a home não respondeu',
    }
  }

  if (resposta.status < 200 || resposta.status >= 300) {
    return {
      ...base,
      verificado: false,
      motivo: 'inacessivel',
      detalhe: `a home respondeu ${resposta.status}, e a etiqueta só pode ser lida numa página que abre`,
    }
  }

  const publicado = lerEtiqueta(resposta.body)
  if (publicado === null) {
    return {
      ...base,
      verificado: false,
      motivo: 'ausente',
      detalhe: `não encontrei <meta name="${META_NAME}"> no HTML de ${hostname}`,
    }
  }
  if (!iguais(publicado, token)) {
    /* Quase sempre é a etiqueta de OUTRA loja, colada no tema errado — e
       dizer isso poupa a pessoa de procurar erro de digitação que não existe. */
    return {
      ...base,
      verificado: false,
      motivo: 'divergente',
      detalhe: `a etiqueta publicada em ${hostname} não é a desta loja (cada domínio tem a sua)`,
    }
  }

  return { verificado: true, hostname, token }
}
