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
exigir "RAIO_X_LEDGER_DIR" "/dados" "sem isto o registro da §2.2 volta para /tmp, que a Fly recria a cada deploy: todo deploy apagaria o intervalo de 24h entre auditorias da mesma loja."

# O VOLUME precisa existir, senão /dados é pasta comum na raiz efêmera — e o
# registro da §2.2 volta a sumir a cada deploy, agora em silêncio, porque a
# gravação funciona igual. Falhar alto é melhor que parecer protegido.
volumes=$(fly volumes list -a "$app" --json 2>/dev/null \
  | python3 -c 'import json,sys; print(len([v for v in json.load(sys.stdin) if v.get("name") == "dados"]))' 2>/dev/null || echo "?")
if [ "$volumes" = "?" ]; then
  vermelho "  não consegui listar os volumes — confira com: fly volumes list -a $app"
elif [ "$volumes" -lt 1 ]; then
  morre "não existe volume 'dados', e o RAIO_X_LEDGER_DIR aponta para /dados.
  Sem ele, /dados é pasta na raiz efêmera: o registro da §2.2 seria gravado e
  apagado no deploy seguinte, sem erro nenhum aparecer.
  Rode uma vez:  fly volumes create dados --size 1 --region gru -a $app"
else
  verde "  volume 'dados' existe (registro da §2.2 sobrevive ao deploy)"
fi

# O nome da app sai do próprio fly.toml, e é lido AQUI porque a checagem de
# máquinas precisa dele antes do deploy. Mais abaixo ele é lido de novo para a
# URL final — de propósito: se o deploy reescrever o arquivo, o segundo valor é
# que vale para a URL.
app=$(grep -E "^app[[:space:]]*=" fly.toml | sed -E "s/.*=[[:space:]]*['\"](.*)['\"].*/\1/")
[ -n "$app" ] || morre "não achei o nome da app no fly.toml."

# UMA MÁQUINA. Não é preferência de custo, é o que o código assume.
#
# O estado da auditoria, a portaria e o ledger da §2.2 vivem na memória e no
# disco do PROCESSO. Com duas máquinas, o balanceador manda o POST para uma e o
# WebSocket para outra: metade dos lojistas fica com a tela girando. E o pior —
# o ledger deixa de ser compartilhado, então a mesma loja de terceiro pode ser
# auditada duas vezes seguidas, que é a §2.2 sendo violada sem ninguém saber.
#
# Foi exatamente o que aconteceu: o fly.toml dizia min 1, o deploy atualizava
# DUAS, e a premissa "é uma máquina só nesta fase" estava escrita num comentário
# que nada verificava. Agora verifica.
maquinas=$(fly machines list -a "$app" --json 2>/dev/null \
  | python3 -c 'import json,sys; print(len([m for m in json.load(sys.stdin) if m.get("state") != "destroyed"]))' 2>/dev/null || echo "?")
if [ "$maquinas" = "?" ]; then
  vermelho "  não consegui contar as máquinas — confira com: fly machines list -a $app"
elif [ "$maquinas" -gt 1 ]; then
  morre "a app está com $maquinas máquinas, e o motor assume UMA.
  O estado da auditoria, a portaria e o ledger da §2.2 vivem no processo. Com mais
  de uma, o WebSocket do lojista pode cair na máquina que não rodou a auditoria
  dele, e o intervalo de 24h entre auditorias da mesma loja deixa de valer — a
  §2.2 é regra de conduta, não conveniência.
  Rode:  fly scale count 1 -a $app
  Para escalar de verdade, o barramento e o ledger precisam sair do processo
  (Redis, como a §3 já prevê). Ver CAL-44."
else
  verde "  máquinas = 1 (o motor assume uma; ver CAL-44)"
fi

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
