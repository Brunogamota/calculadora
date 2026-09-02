# Produto, UX e retenção: heurísticas para as Fases 1 e 6

Este arquivo aprofunda o pensamento de produto do protocolo. Leia quando a feature tiver interface, fluxo de usuário, ou quando o escopo estiver difícil de decidir.

---

## 1. Encontrando o problema real

O pedido raramente é o problema. Cadeia típica: pedido ("quero um relatório em PDF") → tarefa ("todo mês preciso mandar números pro sócio") → problema ("não confio nos números que junto na mão") → solução possivelmente melhor (número confiável e enviado sozinho, sem PDF nenhum).

Perguntas que sobem a cadeia:

- "O que você faz hoje quando precisa disso?"
- "O que acontece depois que você obtém isso?" (a resposta revela a tarefa de verdade)
- "Se isso existisse ontem, o que teria sido diferente na sua semana?"
- "Quem mais encosta nisso além de você?"

Sinais de que ainda não se chegou ao problema: o pedido descreve uma solução ("adiciona um filtro"), o benefício é circular ("preciso do relatório para ter o relatório"), ou ninguém consegue dizer o que muda se não for feito.

## 2. Momento de valor e custo de chegada

Conte, na jornada desenhada, quantas ações o usuário executa até obter o que veio buscar. Cada campo de formulário, cada decisão, cada espera é um pedágio.

Táticas de corte, em ordem de preferência:

1. **Eliminar o passo.** O sistema já tem o dado? Não peça de novo. Dá pra inferir com segurança? Infira e deixe corrigir.
2. **Adiar o passo.** Tudo que não é necessário para o primeiro valor vai para depois do primeiro valor (perfil completo, preferências, configuração fina).
3. **Preencher o passo.** Default sensato escolhido > campo em branco. O usuário edita exceção, não constrói do zero.
4. **Paralelizar a espera.** Se algo demora, mostre progresso real e entregue resultado parcial útil, não spinner mudo.

Se o primeiro valor exige mais de um punhado de ações, o brief deve justificar cada uma.

## 3. Retenção sem fricção

Retenção honesta vem de três fontes, e só destas:

- **Gatilho externo legítimo.** O sistema detecta algo que o usuário quer saber e avisa (alerta, e-mail, notificação). O melhor motor de retorno é o produto trabalhando enquanto o usuário não está olhando. Pergunta de desenho: o que o sistema descobre sozinho que vale um aviso? Aviso sem decisão ou ação embutida é spam.
- **Hábito ancorado em tarefa recorrente.** A feature entra numa rotina que já existe (fechamento semanal, conciliação, virada de mês). Desenhe para o ritmo da rotina, não para uso diário imaginário.
- **Acúmulo de valor.** Quanto mais se usa, mais útil fica (histórico, contexto, configuração aprendida). Se o dado acumulado melhora a experiência, mostre isso ao usuário; valor invisível não retém.

Anti-retenção que não entra: streak artificial, notificação sem informação, tela extra para inflar sessão, dado preso para forçar volta. Métrica de tempo na tela subindo pode ser o produto piorando.

## 4. Os quatro estados, bem feitos

- **Vazio (primeiro uso).** É a página de boas-vindas de fato. Deve responder: o que é isto, o que eu ganho, qual o primeiro passo. Um bom estado vazio tem uma ação, não um pedido de desculpas.
- **Carregando.** Prefira esqueleto do conteúdo a spinner genérico. Acima de poucos segundos, diga o que está acontecendo. Acima disso, considere rodar em background e avisar quando terminar.
- **Erro.** Diga o que falhou em linguagem do usuário, o que ele pode fazer agora, e preserve o que ele digitou. Erro que descarta trabalho do usuário é o defeito mais irritante que existe.
- **Sucesso.** Confirme o resultado e ofereça o próximo passo natural. Sucesso que termina em beco sem saída desperdiça o momento de maior atenção.

## 5. Escopo: decidir o que fica de fora

O corte certo entrega a jornada inteira de um caso, não pedaços de todos os casos. Fatia vertical fina > camada horizontal larga.

Teste para cada item do escopo: "se cortar isso, a jornada mínima ainda fecha?" Se fecha, o item é candidato a "fica de fora". O brief lista o que saiu com motivo de uma linha, para o corte ser decisão e não esquecimento.

Sinais de escopo inchado: mais de um perfil de usuário atendido na primeira rodada, configurabilidade antes do primeiro uso real, tratamento de exceção rara antes do caso comum funcionar redondo.

## 6. Passe de produto da Fase 6: roteiro

Percorra como usuário de primeira vez, sem o conhecimento de quem construiu:

1. Chegue pela porta de entrada real (link, menu, comando), não pela URL direta de quem sabe onde fica.
2. Em cada tela, pergunte: eu saberia o que fazer aqui sem ninguém me explicar?
3. Provoque os quatro estados de propósito: chegue sem dados, force um erro, observe o carregamento em conexão lenta, complete o fluxo.
4. Leia cada texto em voz alta. Jargão interno, mensagem escrita para o desenvolvedor, e tom de template genérico saem.
5. Conte os passos até o valor e compare com a jornada prometida no brief. Diferença para mais é regressão de produto, mesmo com código certo.
6. Pergunte no final: o que aqui faria alguém comentar com um colega? Se a resposta for "nada", a feature está funcional e esquecível; registre isso honestamente no resumo final.

## 7. Perguntas de priorização quando o usuário pede mais de uma coisa

- Qual delas destrava dinheiro ou remove dor ativa agora, e qual é aposta?
- Qual fica mais cara se adiada (migração, dado perdido, cliente esperando)?
- Existe uma que torna as outras mais fáceis ou desnecessárias?
- Qual tem o menor caminho até evidência real de que valeu?

Empate se resolve pelo menor caminho até evidência.
