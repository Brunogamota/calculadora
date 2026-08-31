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
