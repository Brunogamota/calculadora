---
name: destravar
description: Protocolo para destravar defeitos que resistem a correções: depuração por causa raiz, com regra de parada e rota alternativa quando o caminho não fecha. Use SEMPRE que houver erro, teste quebrado, regressão, comportamento inesperado ou stack trace — e OBRIGATORIAMENTE quando uma falha persistir após duas ou mais correções, quando o usuário disser "continua o mesmo erro", "de novo", "não aguento mais" ou demonstrar frustração com tempo perdido, quando a suíte de testes passar enquanto o produto falha, quando a falha ocorrer em vários casos e não só num específico, ou quando o diagnóstico anterior já tiver sido trocado mais de uma vez. A skill proíbe corrigir antes de investigar, força evidência bruta no lugar de narrativa, limita tentativas por hipótese, e — quando a investigação mostrar que o caminho atual não fecha — exige propor uma rota alternativa de valor equivalente em vez de insistir ou degradar o produto. Use inclusive sob pressão de tempo: é exatamente quando chutar parece tentador que este protocolo mais paga.
---

# Depuração por causa raiz

Este protocolo existe porque o ciclo "corrige → falha → explica → corrige de novo" não converge sozinho. Ele parece progresso e não é: cada rodada produz uma narrativa nova e convincente sobre o mesmo defeito não compreendido.

O protocolo tem três compromissos, nesta ordem:

1. **Nenhuma correção sem causa raiz investigada.**
2. **Nenhuma investigação sem evidência bruta.**
3. **Nenhuma insistência infinita: existe regra de parada, e depois dela existe um caminho alternativo que preserva o valor do produto.**

Ele combina quatro fontes: o método científico de depuração de Andreas Zeller (*Why Programs Fail*), a análise É/NÃO É de Kepner-Tregoe, a depuração delta (de onde vem o `git bisect`), e a disciplina de fases com lei de parada popularizada pelas skills de systematic debugging da comunidade Claude Code.

---

## A Lei de Ferro

```
NENHUMA CORREÇÃO SEM INVESTIGAÇÃO DE CAUSA RAIZ ANTES.
```

Sem exceção por pressa, por "é só uma linha", por "é óbvio". Bug simples também tem causa raiz, e "óbvio" é como as duas últimas correções falhadas pareciam na hora.

Violar a letra deste processo é violar o espírito da depuração.

**Complemento da Lei, que as skills comuns não têm:** a investigação tem orçamento. Quando ele estoura sem causa isolada, o caminho não é a sexta tentativa, é a Fase 7. Insistência infinita é tão indisciplinada quanto chute.

---

## Gatilhos de STOP imediato

Se qualquer um destes estiver acontecendo, pare o que está fazendo e volte à Fase 1:

- A correção anterior não mudou o comportamento observado.
- Você está prestes a mudar algo "para ver se resolve".
- Sua explicação atual é uma variação da explicação já refutada.
- Você quer adicionar um caso especial, um rótulo novo numa lista, um `if` para aquela situação.
- Os testes passam e o produto falha.
- Você está descrevendo a correção antes de ter colado a evidência.

**Se três ou mais correções já falharam:** o problema deixou de ser o defeito e passou a ser o entendimento da arquitetura. Vá direto à Fase 6.

---

## Vocabulário: defeito, infecção, falha

Zeller separa três coisas que se confundem, e a confusão custa caro:

**Defeito** é o código errado. Existe mesmo quando ninguém olha.
**Infecção** é o estado errado que o defeito produz em execução, e que se propaga de cálculo em cálculo.
**Falha** é o comportamento errado que alguém observa na ponta.

O sintoma aparece quase sempre na camada mais alta; a causa quase nunca está lá. Investigar onde o sintoma aparece é o erro mais comum e o mais caro.

---

## Os sete vieses

Pelo menos um sempre operou quando se chega a este protocolo. Declarar qual não é penitência: cada viés aponta para um lugar diferente da investigação.

**1. Última mudança.** Assumir que o defeito está no que se acabou de mexer. Frequentemente está numa camada abaixo, intocada há semanas.

**2. Suíte verde.** Teste que roda contra fixture prova que a fixture concorda com o código, nada mais. Suíte verde com produto quebrado é evidência de teste ruim.

**3. Plausibilidade como diagnóstico.** Narrativa coerente não é evidência. Explicação não falseada é hipótese, por mais fluente que soe.

**4. Generalização de um caso.** Consertar um caso e declarar a classe resolvida. Ou o inverso: chamar de "peculiaridade daquele cliente" o que na verdade falha em todos.

**5. Correção em lote.** Cinco mudanças de uma vez, o erro some, ninguém sabe qual resolveu, e três criaram defeitos novos.

**6. Ancoragem.** O primeiro palpite contamina todos os seguintes. Cada correção nova é variação do tema já refutado.

**7. Custo afundado.** Dois dias investidos não são argumento para o terceiro. São argumento para a Fase 7.

---

## Fase 0 — Orçamento

Antes de investigar, declare por escrito:

**Orçamento desta investigação:** quantas horas ou quantos ciclos hipótese-experimento antes de acionar a regra de parada. Padrão: 3 ciclos completos ou o equivalente a meio dia, o que vier primeiro.

**Critério de sucesso:** o que precisa ser observável para declarar o defeito resolvido. Escrito agora, antes de qualquer hipótese, para não ser afrouxado depois.

**Impacto real:** quantos casos o defeito afeta, de quantos. Isso alimenta a decisão da Fase 7: um defeito que atinge um caso em vinte não justifica parar o projeto.

---

## Fase 1 — Delimitar: a matriz É / NÃO É

A fase mais pulada e a mais valiosa. Vem de Kepner-Tregoe, e a lição central: quase todo mundo olha só para onde o problema está. O diagnóstico nasce de olhar com o mesmo cuidado para onde ele **não** está, porque é isso que cria as fronteiras que eliminam causas.

Cada célula vem de comando executado, não de memória.

| dimensão | É | NÃO É | o que a diferença sugere |
|---|---|---|---|
| **O quê** | qual comportamento exato falha | qual comportamento vizinho funciona | |
| **Onde** | componente, arquivo, etapa | onde parecido não falha | |
| **Quando** | desde quando, sob que condição | quando não falha | |
| **Extensão** | em quantos casos, com que frequência | em quantos não ocorre | |

A causa verdadeira precisa explicar **as duas colunas ao mesmo tempo**. Causa que explica a falha mas não explica por que os outros casos passam está incompleta, e correção baseada nela vai falhar.

### As quatro perguntas obrigatórias

**O que exatamente falha.** A menor descrição observável. "Após a chamada X, o estado Y continua vazio." Se a descrição contém explicação, ainda não é descrição.

**Onde.** Arquivo, função, linha, ou a fronteira entre dois componentes.

**Quando começou.** Se já funcionou, `git bisect` encontra o commit culpado em tempo logarítmico e vale mais que qualquer raciocínio. Se **nunca** funcionou em condição real, diga com todas as letras: não há regressão, há funcionalidade que nunca ficou pronta, e a investigação muda de natureza.

**Em quantos casos.** A pergunta que decide tudo:

- **Todos** → defeito em camada baixa e compartilhada: ambiente, sessão, configuração, contrato. Investigar lógica específica de um caso aqui é perda de tempo garantida.
- **Alguns** → existe variável discriminante. Ache-a comparando um caso que passa com um que falha, atributo por atributo.
- **Um** → só então pode ser peculiaridade. Confirme antes de aceitar.

Se não souber em quantos casos falha, **medir isso é o primeiro experimento**: rode contra 3 a 5 casos reais antes de qualquer outra coisa.

---

## Fase 2 — Reproduzir de forma mínima e confiável

Não se depura o que não se reproduz sob demanda.

**Confiável:** o mesmo comando produz a mesma falha, sempre. Se produz às vezes, o problema é intermitente: meça a taxa (20, 50, 100 execuções) antes de investigar causa, senão a próxima execução boa vira "confirmação" de uma correção que não fez nada. O tratamento completo de intermitência está em `references/metodos.md`.

**Mínima:** remova tudo que não é necessário para a falha ocorrer. Cada elemento removido sem a falha sumir é um suspeito eliminado. É a depuração delta feita à mão, e o caso mínimo resultante vira o teste de verificação da Fase 5.

---

## Fase 3 — Isolar a camada

Todo sistema que falha é uma corrente; o defeito está em um elo. Liste as camadas do caminho, da mais baixa à mais alta. Exemplo para automação web:

rede e egresso → DNS/TLS → sessão e cookie → resposta do servidor → contrato da API ou estrutura do documento → detecção do elemento → ação → verificação do sucesso → interpretação.

Roteiros para outros tipos de sistema estão em `references/metodos.md`.

**Teste de baixo para cima, uma camada por vez, com o teste mais burro possível** — tão simples que não possa falhar por outro motivo.

**Pare na primeira camada que falhar.** Tudo acima dela está contaminado; observação lá é ruído. E resista ao impulso de começar pela camada onde o sintoma aparece: é o clássico dos clássicos.

Quando houver um caso que passa e um que falha, use a comparação: registre as duas execuções, ache o primeiro ponto de divergência, e pergunte não só por que o ruim falhou, mas **por que o bom não falhou**. A condição de proteção que existe num e falta no outro costuma ser a resposta.

---

## Fase 4 — Evidência bruta

Regra única, sem exceção: **cole a saída literal, sem interpretar.**

Comando executado e saída crua, por camada testada. Código de status inteiro. Corpo inteiro ou os primeiros mil caracteres. Mensagem de erro completa, com pilha. Se for longo, salve em arquivo e aponte o caminho — nunca substitua por descrição.

"Respondeu com sucesso" já é conclusão, e pode estar errada: `200` com corpo vazio não é sucesso, e essa distinção morre no resumo. Interpretação é a porta por onde o viés entra; esta fase a mantém fechada.

Instrumentação temporária (log, assert) é evidência legítima e não viola a Lei de Ferro, desde que não altere comportamento e seja removida depois.

---

## Fase 5 — Hipótese, previsão, experimento

Agora, e só agora, o ciclo científico de Zeller. Um ciclo por vez:

**Hipótese.** Específica o bastante para gerar previsão. "Algo errado na sessão" não é hipótese; "o cookie não é enviado na segunda requisição" é.

**Previsão, escrita ANTES do experimento.** O que será observado se a hipótese for verdadeira, e o que será observado se for falsa. Hipótese que não distingue os dois casos é inútil: qualquer resultado a "confirma".

**Experimento mínimo.** O menor teste que decide. Muda uma variável.

**Observação.** Bruta, como na Fase 4.

**Conclusão.** Mantida ou rejeitada. Rejeitada também é ganho: o espaço de busca encolheu. Registre o ciclo em uma linha (o caderno de depuração de Zeller) para não repetir experimento nem disfarçar ancoragem.

**Limite: um experimento por hipótese, três hipóteses por rodada.** Estourou, vai para a Fase 6 ou 7 — não para a hipótese número quatro do mesmo tema.

Quando uma hipótese fechar (explica o É, explica o NÃO É, sobreviveu ao experimento), a correção que sai dela precisa de:

- **Localização exata:** arquivo, função, linha.
- **Mecanismo:** a linha reta entre a evidência e a mudança. Sem essa linha, ainda é hipótese.
- **Previsão falseável da correção**, escrita antes de aplicar.
- **Verificação contra o sistema real**, não contra fixture. Se só existe teste com fixture, escrever o teste real faz parte da correção.
- **Uma correção por rodada.** Ordene as demais por probabilidade e espere.

Se a previsão da correção não se confirmar: a hipótese caiu. Volte à Fase 3 com a informação nova. Não remende por cima.

---

## Fase 6 — Questionar a arquitetura

Chega-se aqui por dois caminhos: três ou mais correções falharam, ou a investigação isolou a causa e ela não é um defeito pontual, é uma decisão estrutural.

Perguntas desta fase:

- O componente que falha está tentando fazer duas coisas que se contradizem?
- A abstração escolhida esconde exatamente a informação de que a correção precisa?
- O contrato assumido com a dependência é o contrato real dela, verificado na documentação e no comportamento observado?
- O padrão de defeito tem irmãos? Um defeito estrutural raramente aparece uma vez só.
- Os testes testam o sistema ou testam a fixture? Quantos tocam o sistema real? **Se a resposta for zero, este é o achado principal da investigação inteira**, acima de qualquer correção pontual.

O resultado desta fase pode ser uma refatoração dirigida — e aí ela volta à Fase 5 com hipótese e previsão como qualquer correção — ou a constatação de que o caminho atual não fecha. Nesse caso, Fase 7.

---

## Fase 7 — A saída digna: rota alternativa sem degradar o produto

Esta fase é o que separa este protocolo de teimosia disciplinada. Nem todo defeito merece ser vencido. **Saber parar é resultado de engenharia, não derrota.**

Acione quando: o orçamento da Fase 0 estourou sem causa isolada; a causa está em terceiro e não há controle sobre ela; o comportamento é não determinístico e o custo de domar excede o valor; ou o caso que falha é minoria pequena diante do que funciona.

### As regras da rota alternativa

**1. O valor entregue ao usuário final se mantém.** A alternativa resolve o mesmo problema do usuário por outro caminho, ou entrega honestamente um recorte menor — nunca uma versão quebrada disfarçada de completa.

**2. A limitação vira informação, não silêncio.** O caso não coberto é declarado no produto, com linguagem que não culpa nem o usuário nem o terceiro injustamente. "A auditoria parou no passo X; isso é limitação nossa, não da sua loja" é o padrão. Falha silenciosa e resultado inventado são as duas únicas coisas piores que a falha original.

**3. A alternativa tem a mesma barra de qualidade.** Ela passa pelas mesmas fases deste protocolo se falhar. "É só o fallback" não é licença para gambiarra.

**4. O caminho original não morre: fica documentado.** O que foi tentado, o que foi eliminado, a evidência coletada, e o gatilho que faria valer a pena voltar (dependência atualizou, mais casos apareceram, apareceu dado novo). Investigação interrompida com registro é um ativo; interrompida sem registro é prejuízo.

**5. A decisão é anunciada, não escondida.** O usuário do protocolo (o dono do projeto) recebe: o que não fechou, por quê, qual a alternativa, o que ela cobre e o que não cobre, e o custo de cada opção. A decisão final de trocar de rota é dele.

### Como gerar a alternativa

Três movimentos, tentados nesta ordem:

**Contornar a camada.** A camada que falha pode ser evitável: outra API que entrega o mesmo dado, outro ponto de entrada, outra ordem de operações que não passa pelo elo quebrado.

**Reduzir a promessa.** Entregar o subconjunto que funciona de forma impecável, com o restante marcado como fora de escopo por ora. Um produto que faz menos e diz a verdade vale mais que um que promete tudo e falha imprevisóvelmente.

**Trocar o mecanismo.** O mesmo resultado por meio diferente: onde a automação fina quebra, uma verificação mais grossa e robusta pode entregar 80% do valor com 5% da fragilidade.

Para cada alternativa proposta, declare: valor preservado (em % honesto do original), casos cobertos, casos perdidos, custo de implementação, e riscos novos.

---

## Formato do relatório

```
## Sintoma
[menor descrição observável, sem explicação embutida]

## Orçamento
Declarado: [ciclos/tempo] · Consumido: [quanto]
Critério de sucesso: [escrito na Fase 0]

## Matriz É / NÃO É
| dimensão | É | NÃO É |
| o quê | | |
| onde | | |
| quando | | |
| extensão | | |

## Escopo
Falha em: [todos | alguns | um] de [N] casos reais testados
Último commit funcionando: [hash + caso] ou "nunca funcionou em condição real"

## Reprodução
Comando mínimo: [...]  ·  Confiabilidade: [sempre | X de N]

## Viés reconhecido
[qual dos sete, e como direcionou as tentativas anteriores]

## Camadas testadas
| # | camada | teste | resultado |
[de baixo para cima; parou na primeira falha]

## Evidência bruta
[comando + saída literal por camada]

## Ciclos de hipótese
| hipótese | previsão (antes) | resultado | veredito |

## Suposições auditadas
[o que era "óbvio" e não foi verificado; quantos testes tocam sistema real]

## Causa raiz  (ou "não isolada dentro do orçamento")
[afirmação ligada à evidência; defeito vs infecção vs falha]

## Correção  (quando houver causa)
Arquivo/Função/Linha · Mecanismo · Previsão · Verificação real · Regressão

## Rota alternativa  (quando não houver, ou quando a causa for de terceiro)
Alternativa: [...]
Valor preservado: [%] · Cobre: [...] · Não cobre: [...]
Como a limitação aparece no produto: [texto exato]
Gatilho para reabrir o caminho original: [...]

## O que eu não sei
[perguntas abertas, honestamente]
```

---

## Fechamento de ciclo (após qualquer correção que funcione)

**Por que os testes não pegaram?** A resposta vira teste novo, contra sistema real.
**Onde mais o mesmo padrão existe?** Defeito raramente é filho único.
**O que teria encurtado isto?** Log ausente, erro genérico, fixture divergente — vira melhoria de instrumentação.

---

## Anti-padrões

**"Vou adicionar um caso especial."** Solução que exige alimentar lista à mão a cada caso novo não escala e não é solução.

**"Deve ser porque..."** É hipótese. Marque ou verifique.

**"Corrigi e os testes passam."** Contra o quê? Fixture não conta.

**"Aproveitei e melhorei outras coisas."** Agora ninguém sabe o que resolveu.

**Narrativa fluente sem evidência bruta.** Quanto mais convincente, mais perigosa.

**Trocar de hipótese sem refutar a anterior.** Perde a informação que ela ainda daria.

**Insistir depois do orçamento.** A partir dali, cada hora a mais é tirada da rota alternativa que preservaria o produto.

**Degradar em silêncio.** Fallback que finge ser o caminho principal, resultado inventado, limitação escondida. É a única coisa que este protocolo trata como pior do que o bug.

---

## Referência complementar

`references/metodos.md` — aprofundamento de cada método: ciclo científico de Zeller com exemplos, matriz Kepner-Tregoe completa com teste de causa candidata, depuração delta e roteiro de `git bisect`, localização por comparação, roteiros de isolamento por tipo de sistema, tratamento de falha intermitente, e o caderno de depuração. Leia quando a fase correspondente precisar de mais profundidade.
