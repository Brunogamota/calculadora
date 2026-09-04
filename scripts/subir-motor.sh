#!/usr/bin/env bash
#
# Sobe o motor na Fly, do jeito que ele precisa subir.
#
#   npm run subir
#   npm run subir -- https://meu-site.vercel.app
#
# Existe porque a alternativa era uma lista de comandos soltos no chat, e cada
# um deles tem um jeito de falhar CALADO. O caso real: um `sed` que procurava
# aspas duplas num arquivo que a Fly havia reescrito com aspas simples. Rodou,
# não deu erro, não fez nada — e o deploy teria ido com a origem de exemplo,
# bloqueando o site de verdade.
#
# Por isso aqui tudo que muda é CONFERIDO depois de mudar. Comando que não faz
# o que diz é pior que comando que falha.

set -euo pipefail

vermelho() { printf '\033[31m%s\033[0m\n' "$1"; }
verde()    { printf '\033[32m%s\033[0m\n' "$1"; }
passo()    { printf '\n\033[1m%s\033[0m\n' "$1"; }

morre() { vermelho ""; vermelho "  $1"; vermelho ""; exit 1; }

cd "$(dirname "$0")/.."

# ---------------------------------------------------------------- 1. o básico
passo "1/5  Conferindo o que precisa estar pronto"

command -v fly >/dev/null 2>&1 || morre "o 'fly' não está instalado ou não está no PATH.
  Instale com:  curl -L https://fly.io/install.sh | sh
  E depois:     export PATH=\"\$HOME/.fly/bin:\$PATH\""

quem=$(fly auth whoami 2>/dev/null) || morre "você não está logado na Fly.
  Rode:  fly auth login
  Ele abre o navegador — não digite nada no terminal enquanto isso."
verde "  logado como $quem"

[ -f fly.toml ] || morre "não achei o fly.toml. Você está na pasta do projeto?"
[ -f Dockerfile ] || morre "não achei o Dockerfile. Você está na pasta do projeto?"

# ------------------------------------------------------- 2. a origem do site
passo "2/5  Ajustando de onde o site pode falar com o motor"

# Aceita aspas simples OU duplas: a Fly reescreve o arquivo com as dela, e foi
# exatamente aí que a substituição anterior passou batido.
origem_atual=$(grep -E "^[[:space:]]*RAIO_X_ORIGENS" fly.toml | sed -E "s/.*=[[:space:]]*['\"](.*)['\"].*/\1/" || true)

if [ "${1:-}" != "" ]; then
  nova="$1"
  echo "  usando o endereço que você passou: $nova"
elif [ "$origem_atual" = "https://SEU-SITE.vercel.app" ] || [ "$origem_atual" = "" ]; then
  nova=""
  echo "  deixando ABERTA por enquanto (qualquer origem)."
  echo "  Isso é temporário: rode de novo com o endereço do site quando souber."
else
  nova="$origem_atual"
  echo "  mantendo a que já estava: $nova"
fi

# `|` como separador porque o valor é uma URL, cheia de barras.
sed -i.bak -E "s|^([[:space:]]*RAIO_X_ORIGENS[[:space:]]*=[[:space:]]*).*|\1'${nova}'|" fly.toml && rm -f fly.toml.bak

# CONFERE que a troca aconteceu. Foi a ausência disto que deixou passar.
depois=$(grep -E "^[[:space:]]*RAIO_X_ORIGENS" fly.toml | sed -E "s/.*=[[:space:]]*['\"](.*)['\"].*/\1/" || true)
[ "$depois" = "$nova" ] || morre "a troca da origem NÃO pegou.
  esperado: '$nova'
  no arquivo: '$depois'
  Não vou seguir com o deploy assim."
verde "  origem no arquivo: '${depois:-（aberta）}'"

# ------------------------------------------------ 3. o resto da configuração
passo "3/5  Conferindo a configuração que decide o comportamento"

exigir() {
  local chave="$1" esperado="$2" porque="$3"
  local achado
  achado=$(grep -E "^[[:space:]]*${chave}[[:space:]]*=" fly.toml | head -1 | sed -E "s/.*=[[:space:]]*['\"]?([^'\"]*)['\"]?.*/\1/" | tr -d ' ' || true)
  if [ "$achado" != "$esperado" ]; then
    morre "$chave está '$achado', esperado '$esperado'.
  $porque
  O 'fly launch' reescreve o fly.toml e pode ter trocado isto."
  fi
  verde "  $chave = $esperado"
}

exigir "primary_region" "gru" "gru é São Paulo. Auditar loja brasileira de outro país faz o tempo de carregamento virar achado injusto contra o lojista."
exigir "memory" "1gb" "abaixo disso o teto de 3 auditorias simultâneas não cabe: cada uma custa ~118 MB."
exigir "RAIO_X_MAX_SIMULTANEAS" "3" "sem teto, cada pedido sobe um Chromium e a máquina cai no meio da auditoria de quem estava assistindo."
exigir "min_machines_running" "1" "com zero, a primeira auditoria espera a máquina subir — e a tela ao vivo é o produto."

# ------------------------------------------------------------- 4. o deploy
passo "4/5  Subindo (a primeira vez demora: a imagem traz um Chromium inteiro)"
fly deploy

# ------------------------------------------------------------ 5. está vivo?
passo "5/5  Perguntando ao motor se ele está de pé"

host=$(grep -E "^app[[:space:]]*=" fly.toml | sed -E "s/.*=[[:space:]]*['\"](.*)['\"].*/\1/")
saude="https://${host}.fly.dev/health"

for tentativa in $(seq 1 20); do
  if resposta=$(curl -fsS --max-time 5 "$saude" 2>/dev/null); then
    verde ""
    verde "  O motor está no ar."
    echo "  $saude"
    echo "  $resposta"
    printf '\n\033[1m%s\033[0m\n' "  Falta uma coisa para o site usar o motor:"
    echo "    1. No Vercel → Settings → Environment Variables:"
    echo "         VITE_API = https://${host}.fly.dev"
    echo "    2. Faça um deploy NOVO no Vercel. O VITE_API entra na hora de"
    echo "       CONSTRUIR, não de servir — redeploy do build antigo não adianta."
    echo ""
    exit 0
  fi
  sleep 3
done

morre "o deploy terminou, mas o motor não respondeu em $saude depois de 60s.
  Veja o que ele está dizendo:  fly logs"
