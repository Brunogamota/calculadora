# Métodos de diagnóstico — referência de aprofundamento

Leia a seção correspondente quando a fase do protocolo pedir mais profundidade.

## Índice

1. O ciclo científico de Zeller, com exemplo completo
2. A matriz É / NÃO É de Kepner-Tregoe, com teste de causa candidata
3. Depuração delta e o roteiro de git bisect
4. Localização de falha por comparação
5. Roteiros de isolamento por camada, por tipo de sistema
6. Falha intermitente: o tratamento completo
7. O caderno de depuração
8. Origem dos métodos

---

## 1. O ciclo científico de Zeller

Formalizado em *Why Programs Fail: A Guide to Systematic Debugging*. A depuração vira uma sequência de experimentos, cada um com cinco passos que não se pulam.

**Hipótese.** Afirmação específica sobre o estado do programa. Precisa ser refutável. "Algo está errado no carrinho" não gera experimento; "o cookie de sessão criado na página do produto não está presente na requisição de adicionar" gera.

**Previsão.** Escrita ANTES do experimento: o que será observado se a hipótese for verdadeira, e o que será observado se for falsa. Este é o passo que todo mundo pula, e é o que torna a refutação possível. Sem previsão prévia, qualquer resultado pode ser reinterpretado a favor da hipótese — e é assim que se passam dois dias em círculo.

**Experimento.** O menor teste que decide entre as duas previsões. Muda uma variável só.

**Observação.** O resultado bruto, sem interpretação nesta etapa.

**Conclusão.** Hipótese mantida ou rejeitada. Rejeição é ganho: o espaço de busca encolheu, e o que foi eliminado fica registrado para ninguém voltar lá.

### Exemplo completo

Sintoma: após a chamada de adicionar ao carrinho, o carrinho segue vazio.

- Hipótese 1: a requisição não está sendo enviada.
  - Previsão: o registro de rede não mostrará o POST. Se mostrar, hipótese cai.
  - Experimento: capturar tráfego durante a ação.
  - Observação: o POST aparece, status 200.
  - Conclusão: rejeitada. Ganho: o problema está do 200 para frente.
- Hipótese 2: o 200 vem com corpo de erro.
  - Previsão: o corpo conterá indicação de falha. Se contiver o item, hipótese cai.
  - Experimento: logar o corpo da resposta.
  - Observação: corpo contém o item adicionado.
  - Conclusão: rejeitada. Ganho: o servidor aceitou. O problema está na leitura posterior.
- Hipótese 3: a verificação lê o carrinho numa sessão diferente da que adicionou.
  - Previsão: os cookies das duas requisições serão diferentes. Se forem iguais, cai.
  - Experimento: comparar cookies do POST e do GET.
  - Observação: cookies diferentes.
  - Conclusão: mantida. Causa raiz: contexto de sessão recriado entre ação e verificação.

Três ciclos, cada um encolhendo o espaço. Compare com "deve ser o seletor do botão" repetido cinco vezes.

### A aplicação à correção

Aplicar uma correção É um experimento. A previsão é o comportamento esperado depois dela, escrita antes de aplicar. Se não se confirmar, a hipótese por trás da correção caiu — e insistir com variação da mesma ideia é ancoragem, não persistência.

---

## 2. A matriz É / NÃO É de Kepner-Tregoe

Da Problem Analysis de Charles Kepner e Benjamin Tregoe (*The Rational Manager*, 1965). Um "problema", no método, é um desvio de desempenho esperado cuja causa é desconhecida. O método existe para impedir o salto do sintoma para a causa presumida.

### A matriz completa

| dimensão | É (o que se observa) | NÃO É (o que poderia e não se observa) |
|---|---|---|
| O quê | qual objeto, qual desvio exato | objetos parecidos sem o desvio; desvios parecidos que não ocorrem |
| Onde | onde no sistema, onde no objeto | onde poderia ocorrer e não ocorre |
| Quando | primeira vez, padrão desde então, ponto do ciclo | quando poderia e não ocorre |
| Extensão | quantos objetos, magnitude, tendência | qual poderia ser e não é |

### As distinções e as mudanças

Para cada linha: **o que distingue o É do NÃO É?** Cada distinção é uma pista. Em seguida: **o que mudou em relação a essa distinção, e quando?** Causa costuma morar numa mudança.

### O teste de causa candidata

Para cada causa proposta: **se esta é a causa, como ela explica tanto o É quanto o NÃO É?**

Uma causa que explica por que o caso X falha mas precisa de condição inventada para explicar por que Y e Z passam está provavelmente errada. A causa verdadeira explica as duas colunas sem esforço.

### Quando usar

O método é caro. Vale quando acertar importa mais que ser rápido: problema recorrente, que já resistiu a tentativas, ou com consequência financeira. Para bug trivial, é excesso — mas se o bug fosse trivial, este protocolo não teria sido acionado.

---

## 3. Depuração delta e o roteiro de git bisect

Proposta por Andreas Zeller em "Yesterday, my program worked. Today, it does not. Why?" (ESEC/FSE 1999). Isola causas estreitando sistematicamente as circunstâncias da falha até restar o conjunto mínimo que ainda a reproduz.

Aplica-se a três coisas:

**Entrada.** Remover partes da entrada que reproduz a falha até que qualquer remoção a faça sumir. O que sobra aponta o defeito.

**Interação.** A sequência mínima de ações que reproduz.

**Histórico.** Aplicada aos commits, vira a bissecção:

```
git bisect start
git bisect bad                # o estado atual falha
git bisect good <hash>        # um commit que comprovadamente funcionava
# a cada passo: testar, marcar good ou bad
git bisect reset              # ao terminar
```

Com teste automatizável: `git bisect run <comando>` faz tudo sozinho. Cem commits viram sete testes.

### Quando a bissecção NÃO ajuda

- Nunca funcionou: não existe commit good. (E descobrir isso já é um resultado que muda a investigação.)
- Falha intermitente: as marcações ficam não confiáveis e o bisect converge para o commit errado. Trate a intermitência primeiro (seção 6).
- Causa fora do repositório: dependência, ambiente, dado externo.

---

## 4. Localização de falha por comparação

Quando existe um caso que passa e um que falha, a diferença entre eles é o espaço de busca inteiro.

Roteiro mecânico:

1. Registre a execução completa dos dois casos, com o mesmo nível de detalhe.
2. Alinhe as execuções ponto a ponto.
3. Encontre o primeiro ponto de divergência. O defeito está nele ou antes dele — nunca depois.
4. Inverta a pergunta: em vez de "por que o ruim falhou", **"por que o bom não falhou?"** A condição de proteção presente num e ausente no outro costuma ser a resposta.

Ferramentas: registro estruturado idêntico nos dois casos, diff das saídas, comparação de estado em pontos de checagem fixos.

---

## 5. Roteiros de isolamento por camada

Sempre de baixo para cima, um teste burro por camada, parando na primeira que falhar.

### Automação de navegador

1. O processo tem saída de rede? Requisição a endereço público conhecido, do mesmo processo.
2. DNS resolve o domínio alvo?
3. TLS fecha?
4. O navegador sobe e fecha sem navegar?
5. A página carrega? Título legível?
6. Cookie e sessão persistem entre navegações?
7. O contrato da API responde chamado isolado, fora do fluxo?
8. O elemento é encontrado, sem agir sobre ele?
9. A ação executa, sem verificar?
10. A verificação enxerga a mudança de estado?

### Serviço com banco

processo sobe → variável de ambiente presente → credencial válida → conexão estabelece → permissão suficiente → esquema corresponde → consulta retorna → transformação preserva → serialização emite.

### Integração com terceiro

rede → autenticação → formato do pedido → aceitação → formato da resposta → interpretação → tratamento de erro → repetição e limite de taxa.

### Pipeline assíncrono

mensagem publicada → fila recebeu → consumidor vivo → consumidor pegou → processamento não lançou → resultado persistiu → confirmação voltou → mensagem não retornou à fila.

---

## 6. Falha intermitente: o tratamento completo

Intermitência exige uma etapa extra, e pulá-la gera correções fantasma.

**1. Meça a taxa antes de tudo.** 20, 50, 100 execuções do caso de reprodução. Sem taxa base, é impossível validar correção: se falha 1 em 5, três execuções boas depois da correção não provam nada.

**2. Cace a fonte de não determinismo.** As usuais: concorrência e ordem de execução; espera fixa por tempo em vez de por condição; estado compartilhado entre execuções; aleatoriedade sem semente; rede; ordem de iteração não garantida; fuso e relógio; cache.

**3. Torne determinístico antes de corrigir.** Semente fixa, concorrência serializada, tempo congelado, estado limpo entre execuções. Se a falha some ao tornar determinístico, a fonte removida é a pista principal.

**4. Valide estatisticamente.** Depois da correção, a mesma quantidade de execuções da medição inicial. Correção de intermitente só se valida por taxa, nunca por uma execução boa.

---

## 7. O caderno de depuração

Recomendação de Zeller que sobrevive intacta ao trabalho com agentes: registrar cada ciclo em uma linha — hipótese, previsão, experimento, observação, veredito.

Três ganhos concretos:

- **Não repetir experimento.** Em investigação longa, testar duas vezes a mesma coisa sem notar é comum.
- **Expor ancoragem.** Cinco hipóteses seguidas que são variações da mesma ideia ficam visíveis no papel e invisíveis na memória.
- **Preservar o eliminado.** Hipótese refutada é ganho; sem registro, o ganho evapora e alguém reinvestiga o mesmo beco.

---

## 8. Origem dos métodos

**Ciclo científico, vocabulário defeito/infecção/falha, caderno:** Andreas Zeller, *Why Programs Fail: A Guide to Systematic Debugging*, Morgan Kaufmann. Agnóstico de linguagem; segue sendo a referência central do assunto.

**Depuração delta:** Andreas Zeller, "Yesterday, my program worked. Today, it does not. Why?", ESEC/FSE 1999. O `git bisect` e equivalentes são a aplicação direta ao histórico de versões.

**Matriz É / NÃO É:** Charles Kepner e Benjamin Tregoe, *The Rational Manager*, 1965. Nasceu para corrigir o salto prematuro do sintoma à causa presumida; adotada depois em qualidade, manufatura e gestão de incidentes de TI.

**Lei de Ferro e disciplina de fases com regra de parada:** consolidadas na prática recente de skills de depuração sistemática para agentes de código (a formulação "NO FIXES WITHOUT ROOT CAUSE INVESTIGATION FIRST" e o gatilho "3+ correções falhadas → questione a arquitetura" vêm dessa tradição). A Fase 7 deste protocolo — rota alternativa com valor preservado e limitação declarada — é a extensão que essas skills não trazem.
