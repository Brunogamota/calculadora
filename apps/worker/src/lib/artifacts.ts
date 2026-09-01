/**
 * Persistência de evidência em disco. §19: "salve o HTML das lojas que
 * falharem" — colar HTML real resolve seletor em minutos, descrever por cima
 * leva meia hora.
 *
 * Salvar é automático quando a detecção cai no fallback genérico: é justamente
 * aí que alguém vai precisar olhar o HTML.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import path from 'node:path'

export const DEFAULT_OUT_DIR = 'out'

function slug(hostname: string): string {
  return hostname.replace(/[^a-z0-9.-]/gi, '_')
}

/**
 * Uma pasta por loja: `out/www.loja.com.br/`.
 *
 * Era `out/www.loja.com.br-home.html` para HTML e JSON, e `out/www.loja.com.br/`
 * para os screenshots — duas convenções no mesmo diretório, e nenhuma das duas
 * inteira. Procurar a evidência de uma auditoria virava adivinhar qual das duas
 * o arquivo tinha seguido. Agora tudo da mesma loja mora no mesmo lugar.
 */
export function pastaDaLoja(outDir: string, hostname: string): string {
  return path.join(outDir, slug(hostname))
}

/**
 * Guarda um pedaço de evidência em JSON, ao lado do HTML e dos screenshots.
 *
 * Existe porque a pergunta "o que a API respondeu, e o que o carrinho mostrou
 * logo depois?" não tinha resposta possível sobre uma auditoria já feita: o
 * dado passava pela memória e ia embora com o processo. Evidência que só
 * existe enquanto o processo vive não é evidência.
 */
export async function saveJson(
  outDir: string,
  hostname: string,
  label: string,
  dados: unknown,
): Promise<string> {
  const dir = pastaDaLoja(outDir, hostname)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${label}.json`)
  await writeFile(file, `${JSON.stringify(dados, null, 2)}\n`, 'utf8')
  return file
}

export async function saveHtml(outDir: string, hostname: string, label: string, html: string): Promise<string> {
  const dir = pastaDaLoja(outDir, hostname)
  await mkdir(dir, { recursive: true })
  const file = path.join(dir, `${label}.html`)
  await writeFile(file, html, 'utf8')
  return file
}
