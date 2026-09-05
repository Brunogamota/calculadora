/**
 * Pistas de que a auditoria está rodando num ambiente de desenvolvimento na
 * nuvem — e portanto quase certamente fora do Brasil.
 *
 * `--from-br` é uma DECLARAÇÃO de verdade: com ela, o motor passa a julgar
 * tempo de carregamento e a tratar modal de região como achado real contra a
 * loja. Declarada por engano de um datacenter, ela produz exatamente o falso
 * positivo que o resto do motor evita.
 *
 * Não dá para saber o país sem consultar serviço externo, mas dá para
 * reconhecer o ambiente: essas variáveis são postas pelas próprias
 * plataformas. Quando a declaração contradiz o ambiente, o motor não recusa —
 * ele AVISA, alto, no próprio resultado. Quem roda é quem sabe; quem lê o
 * relatório precisa saber também.
 */

export interface CloudEnvironment {
  name: string
  variable: string
}

const CLOUD_MARKERS: Array<{ name: string; variable: string; matches: (value: string) => boolean }> = [
  { name: 'GitHub Codespaces', variable: 'CODESPACES', matches: (v) => v === 'true' },
  { name: 'Gitpod', variable: 'GITPOD_WORKSPACE_ID', matches: (v) => v.length > 0 },
  { name: 'Google Cloud Shell', variable: 'CLOUD_SHELL', matches: (v) => v === 'true' },
  { name: 'AWS CloudShell', variable: 'AWS_EXECUTION_ENV', matches: (v) => v.includes('CloudShell') },
  { name: 'GitHub Actions', variable: 'GITHUB_ACTIONS', matches: (v) => v === 'true' },
]

export function detectCloudEnvironment(env: NodeJS.ProcessEnv = process.env): CloudEnvironment | null {
  for (const marker of CLOUD_MARKERS) {
    const value = env[marker.variable]
    if (typeof value === 'string' && marker.matches(value)) {
      return { name: marker.name, variable: marker.variable }
    }
  }
  return null
}

/** Aviso quando a declaração de origem contradiz o ambiente detectado. */
export function vantageContradiction(
  declaredFromBrazil: boolean | undefined,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (declaredFromBrazil !== true) return null
  const cloud = detectCloudEnvironment(env)
  if (!cloud) return null
  return (
    `--from-br foi declarado, mas isto parece ser ${cloud.name} (${cloud.variable}), ` +
    'que roda em datacenter e quase certamente não está no Brasil. Se a declaração estiver ' +
    'errada, o tempo de carregamento vira achado injusto e modal de região deixa de ser ' +
    'tratado como artefato. Rode da sua própria máquina para medir do Brasil.'
  )
}

/**
 * Regiões de plataforma que ficam no Brasil de verdade.
 *
 * Isto NÃO é palpite: é a plataforma dizendo onde a máquina está. `FLY_REGION`
 * vem do ambiente da máquina em execução, e é evidência melhor que uma flag de
 * linha de comando — a flag diz o que a pessoa acredita, a variável diz onde o
 * processo está.
 *
 * `primary_region` do `fly.toml` não serve para isto: ele é a preferência, e a
 * Fly pode subir a máquina em outro lugar. O que vale é onde ela subiu.
 */
const REGIOES_BRASILEIRAS: Array<{ variavel: string; regioes: readonly string[]; plataforma: string }> = [
  { variavel: 'FLY_REGION', regioes: ['gru'], plataforma: 'Fly.io' },
]

export interface OrigemDoAmbiente {
  plataforma: string
  variavel: string
  regiao: string
}

/**
 * A auditoria está saindo do Brasil, segundo a própria plataforma?
 *
 * Devolve a evidência, não só um booleano: quem lê o relatório precisa saber
 * POR QUE o motor concluiu isso, e "porque a Fly diz que a máquina está em gru"
 * é verificável de um jeito que "true" não é.
 */
export function origemBrasileiraDoAmbiente(env: NodeJS.ProcessEnv = process.env): OrigemDoAmbiente | null {
  for (const { variavel, regioes, plataforma } of REGIOES_BRASILEIRAS) {
    const valor = env[variavel]
    if (typeof valor === 'string' && regioes.includes(valor.trim().toLowerCase())) {
      return { plataforma, variavel, regiao: valor.trim().toLowerCase() }
    }
  }
  return null
}
