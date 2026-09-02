---
name: construir
description: Protocolo para construir feature nova com cabeça de produto. Use ao criar qualquer feature, tela, fluxo ou melhoria. Força entender problema, UX e retenção antes do código, e pronto só com evidência.
---

# Construir: feature com cabeça de produto

Este protocolo existe porque feature construída como ticket literal sai errada mesmo quando o código sai certo. O agente implementa exatamente o que foi pedido, sem perguntar se aquilo resolve o problema, sem pensar em quem vai usar, e declara pronto em cima de teste que ele mesmo escreveu. O resultado é software que funciona na demo e não muda nada na vida do usuário.

O protocolo tem três compromissos, nesta ordem:

1. **Nenhum código antes do brief aprovado.** Entender o problema não é fase burocrática, é onde a feature é decidida.
2. **Produto antes de engenharia.** Experiência, momento de valor e motivo de retorno são decididos antes da arquitetura, porque a arquitetura existe para servir isso.
3. **Pronto só com evidência.** Feature marcada como pronta sem execução real demonstrada é dívida disfarçada de progresso.

Ele combina o fluxo por fases do feature-dev oficial da Anthropic, o enquadramento de produto do gstack (a pergunta "o que tornaria isso tão bom que o usuário contaria pra alguém"), a entrevista até entendimento compartilhado do grill-me, e as guardas anti over-engineering popularizadas pelas skills de Karpathy.

---

## Regra zero

```
NENHUMA LINHA DE CÓDIGO ANTES DO BRIEF APROVADO PELO USUÁRIO.
```

Sem exceção por "é simples", por "é só um botão", por pressa. Feature pequena também tem usuário, também tem estado de erro, também pode ser a coisa errada a construir. Se o pedido for realmente trivial (renomear um campo, ajustar um texto), diga que o protocolo não se aplica e resolva direto, mas diga isso explicitamente em vez de fingir que seguiu as fases.

---

## Fase 0: Enquadramento de produto

Antes de pensar em como construir, estabeleça se e o que construir. Responda com o usuário, não por ele:

1. **Qual problema isso resolve, e de quem?** "O usuário quer X" não é problema, é pedido. O problema é o que acontece na vida dele sem o X.
2. **Como esse problema aparece hoje?** Onde a pessoa trava, o que ela faz de gambiarra, quanto tempo perde. Se ninguém sofre sem a feature, questione se ela deve existir.
3. **O que tornaria isso tão bom que o usuário contaria pra alguém?** Esta pergunta separa a versão burocrática da versão que importa. A resposta vira o alvo da Fase 1.
4. **Como saberemos que funcionou?** Métrica ou sinal observável, definido antes de construir. "Ficou no ar" não é sucesso.
5. **O que acontece se a gente não construir?** Se a resposta for "nada", pare e diga isso.

Entreviste até fechar entendimento. Máximo de 4 perguntas por rodada, priorizadas: pergunte primeiro o que muda o desenho da solução. Não avance com lacuna preenchida por suposição sua; suposição silenciosa nesta fase vira retrabalho na Fase 5.

Se o pedido já vier com contexto de produto resolvido (brief, spec, decisão tomada em conversa anterior), registre o que foi decidido e pule para a Fase 1. Não re-entreviste o que já foi respondido.

---

## Fase 1: Experiência e retenção

Feature não é código que roda, é uma mudança no comportamento de alguém. Antes da arquitetura, defina:

**Jornada mínima.** De onde o usuário vem, o que ele vê, o que ele faz, com o que ele sai. Escreva em passos numerados, na perspectiva do usuário, não do sistema.

**Momento de valor.** Em que passo exato o usuário obtém o que veio buscar, e quanto custa chegar lá (cliques, campos, espera, decisões). Cada passo antes do valor é um ponto de abandono. Corte o que der.

**Motivo de retorno.** O que faz a pessoa usar de novo: um gatilho externo (notificação, alerta, e-mail), um hábito que a feature cria, ou nada. Se for nada, diga isso no brief; feature sem motivo de retorno é feature de uso único e o escopo deve refletir isso.

**Os quatro estados.** Toda tela ou fluxo tem primeiro uso (vazio), carregando, erro e sucesso. Defina os quatro. Estado vazio que só diz "nenhum item" é oportunidade jogada fora: é onde se ensina o próximo passo.

**Menos tempo, não mais.** Uma feature boa reduz o trabalho do usuário; ela não cria uma tela nova para ele operar. Antes de propor interface, pergunte: dá pra resolver sem tela? Dá pra descobrir sozinho, executar sozinho e só avisar quando precisar de decisão humana? Engajamento forçado não é retenção, é fricção.

Detalhe e heurísticas em `references/produto.md`. Leia quando a feature tiver interface ou fluxo de usuário não trivial.

---

## Fase 2: Exploração do código existente

Antes de desenhar, entenda o terreno:

- Encontre features análogas no código e liste os padrões que elas seguem (estrutura, nomes, camadas, testes).
- Identifique os arquivos-chave que a feature vai tocar, com caminho e papel de cada um.
- Registre restrições reais: dependências, limites da infra, decisões antigas que não valem a pena reabrir agora.

Siga o padrão existente a menos que haja motivo forte e declarado para divergir. Consistência vale mais que elegância local.

---

## Fase 3: Brief

Consolide as fases 0 a 2 num brief curto e submeta para aprovação. Formato:

```
## Problema
(de quem, como aparece hoje, o que custa)

## Solução proposta
(jornada em passos, momento de valor, motivo de retorno, os quatro estados)

## Escopo do agora
(o que entra nesta rodada)

## Fica de fora
(o que foi conscientemente adiado, com uma linha de motivo)

## Critérios de aceite
(verificáveis, um por linha: "usuário faz X e observa Y")

## Sinal de sucesso
(a métrica ou observação definida na Fase 0)

## Riscos e dúvidas abertas
(o que pode dar errado, o que ainda não se sabe)
```

Critério de aceite não verificável não é critério, é desejo. "Interface intuitiva" não entra; "usuário completa o fluxo sem instrução externa" entra.

**Espere a aprovação.** Se o usuário mudar o escopo, atualize o brief antes de codar, não durante.

---

## Fase 4: Plano técnico

Com o brief aprovado:

- Desenhe a arquitetura mínima que atende os critérios de aceite. Mínima significa: sem abstração para futuro hipotético, sem configurabilidade que ninguém pediu, sem camada "pra quando escalar".
- Registre as decisões com trade-off explícito (escolhi A em vez de B porque C).
- Liste o que o plano **não** toca. Código ortogonal ao escopo não é tocado nem "de passagem": refactor oportunista entra como sugestão no fim, não como mudança no meio.
- Quebre em fatias verticais: cada fatia atravessa o sistema e termina em algo executável e verificável. Fatia que só "prepara terreno" e não pode ser demonstrada é sinal de quebra errada.

Se o plano revelar que o brief era inviável ou caro demais, volte ao brief e renegocie escopo. Não absorva a diferença silenciosamente.

---

## Fase 5: Implementação por fatias

Uma fatia por vez:

1. Implemente a fatia completa.
2. Execute de verdade e cole a evidência: saída de comando, resposta de API, tela renderizada. Descrição do que "deveria acontecer" não é evidência.
3. Escreva teste que falharia se a fatia quebrasse. Teste que só passa porque a fixture foi ajustada para concordar com o código não conta: se você precisar ajustar a fixture para o teste passar, pare e avise em vez de ajustar.
4. Confira contra o brief: a fatia atende quais critérios de aceite? Marque-os.
5. Commit pequeno com mensagem que diz o que mudou no produto, não só no código.

Regras durante a implementação:

- Escopo fechado. Descobriu algo fora do escopo que precisa mudar? Avise e pergunte, não faça.
- Faltou informação? Uma pergunta objetiva vale mais que uma suposição confiante.
- Travou num defeito que resiste a correção? Pare de tentar variações e invoque o protocolo de depuração por causa raiz (destravar), se disponível. Construção e depuração são modos diferentes.

---

## Fase 6: Revisão em dois passes

Antes de declarar pronto, revise com dois chapéus, nesta ordem:

**Passe de engenharia (staff engineer cético).** Procure: complexidade desnecessária, código morto, caso de borda ignorado, erro engolido, segredo hardcoded, quebra de padrão do projeto sem motivo. Para cada achado, corrija ou registre com motivo de não corrigir agora.

**Passe de produto (designer impaciente).** Percorra a jornada da Fase 1 como usuário de primeira vez. Procure: passo a mais antes do valor, texto que só faz sentido pra quem construiu, os quatro estados de fato implementados, aparência de template genérico. Interface que precisa de explicação falhou no critério, mesmo funcionando.

---

## Fase 7: Pronto com evidência

"Pronto" exige, nesta ordem:

1. Cada critério de aceite do brief verificado por execução real, um a um, com evidência colada.
2. O sinal de sucesso da Fase 0 instrumentado ou, se não der agora, registrado como pendência explícita com dono.
3. README e docs atualizados dizendo a verdade: o que funciona, o que ficou de fora, o que é conhecido e não resolvido. Marcar bloco como pronto sem funcionar em condição real é a mentira mais cara que um repositório conta.
4. Resumo final para o usuário: o que foi entregue, o que ficou de fora e por quê, e qual a menor próxima coisa que aumentaria o valor.

---

## Anti-padrões

- Começar a codar "só um esqueleto" antes do brief. O esqueleto vira compromisso.
- Transformar pedido vago em spec inventada sem perguntar. Precisão falsa é pior que pergunta.
- Adicionar tela, dashboard ou botão como resposta padrão. A melhor interface para muita coisa é nenhuma.
- Prometer no brief e cortar na implementação sem avisar. Escopo se renegocia, não se erode.
- Teste verde como sinônimo de funcionando. Verde só vale se o teste puder falhar.
- Refactor "aproveitando que estou aqui". Anota, sugere no fim, não faz.
- Declarar pronto na sexta-feira do jeito que der. Pronto sem evidência é sexta-feira emprestando problema pra segunda.

---

## Referência complementar

- `references/produto.md`: heurísticas detalhadas de UX, retenção e priorização para a Fase 1 e o passe de produto da Fase 6. Leia quando a feature envolver interface, fluxo de usuário ou decisão de escopo difícil.
