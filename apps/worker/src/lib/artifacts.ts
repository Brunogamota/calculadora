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
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `${slug(hostname)}-${label}.json`)
  await writeFile(file, `${JSON.stringify(dados, null, 2)}\n`, 'utf8')
  return file
}

export async function saveHtml(outDir: string, hostname: string, label: string, html: string): Promise<string> {
  await mkdir(outDir, { recursive: true })
  const file = path.join(outDir, `${slug(hostname)}-${label}.html`)
  await writeFile(file, html, 'utf8')
  return file
}
