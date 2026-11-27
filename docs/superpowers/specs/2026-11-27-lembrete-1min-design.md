# Meeds B 1.6 — lembrete de 1 min, som novo, fila que se atualiza e convite da janela

## Por quê

O Meeds B atende pacientes do **privado**. Hoje o paciente espera muito e o
médico demora a reagir: o lembrete só volta em 2 min (Discreto) ou 5 min
(Completo), e — pior — só toca se o contador "Aguardando" foi lido há ≤12 s,
o que fora da tela do Pronto Atendimento nunca acontece. O site ainda tem três
defeitos que o alarme pode contornar: a tela não se atualiza sozinha, o médico
tenta puxar um paciente que outro já levou e dá erro, e o contador fica parado
fora do Pronto Atendimento.

Escopo: **só o alarme**. Os outros módulos do Assistente Meeds (A) não entram.

## Objetivos

1. **Lembrete a cada 1 min** enquanto houver paciente esperando (Completo e
   Discreto). Silencioso continua mudo.
2. **Som padrão novo**: alerta de 3 notas subindo, inspirado no padrão de
   prioridade média da IEC 60601-1-8 (faixa 500–3000 Hz), timbre limpo —
   soa como alerta, não como sirene. Sintetizado, sem arquivo.
3. **O script consulta a fila sozinho** (`GET /api/doctor/queues/mine`, a fila
   do próprio médico) a cada 15 s. Isso torna o contador e o lembrete válidos
   em qualquer tela.
4. **"A fila mudou"**: quando a consulta vê que um paciente saiu da fila e o
   médico está no Pronto Atendimento, aparece uma barra com o botão
   "Atualizar fila", que recarrega a lista do próprio app.
5. **Tempo de espera no aviso** ("2 aguardando · o mais antigo há 4 min").
   Com ≥5 min de espera, o lembrete do Discreto sobe um degrau (faixa + moldura).
6. **Convite da janela de aviso**: na primeira vez, um cartão pergunta se o
   médico quer ativar os avisos fora da aba (notificação + janela), testa no
   próprio clique e, se o navegador bloquear, ensina o passo a passo.
7. **Visual do A**: cabeçalho branco, sino em SVG nas três intensidades.

## Não-objetivos

- REMUME, exames, avisos de município, lateral (dock) do A.
- Clicar em "Atualizar" sozinho, sem o médico pedir.
- Pausar o lembrete pelo status "Disponível"/em consulta (fica para depois).

## Anti-objetivos (seria falha mesmo funcionando)

- Gravar qualquer dado de paciente ou o token de acesso em disco.
- Lembrete tocando com a fila comprovadamente vazia.
- Consulta própria derrubando a tela (erro não tratado, laço de requisições).

## Restrições

- Privacidade do README continua valendo; o trecho "o script não faz
  requisição própria" é substituído por "faz uma única consulta de leitura, à
  fila do médico logado, a cada 15 s".
- O cabeçalho de autenticação é copiado da chamada que o **próprio app** fez e
  vive só em memória.
- Sem dependências novas. `npm run verificar` precisa passar.

## Abordagens consideradas

| | Abordagem | Trade-off |
|---|---|---|
| **Escolhida** | Evoluir o B atual (4 arquivos), trazendo do A só a regra de tempo de espera e o CSS do cabeçalho/ícones | Menor mudança; mantém testes e build |
| Descartada | Portar `modules/alarme-fila` do A com o núcleo (dock, manager, network-hub) | Traz lateral e núcleo que o B não usa; seletores do A não valem no Meeds Doctor |
| Descartada | Continuar passivo (só ler o que a tela busca) | Lembrete de 1 min não tocaria fora do Pronto Atendimento; os três problemas continuam |

## Decisões do builder (marcadas como minhas)

- Intervalo da consulta: 15 s; frescor aceito para o lembrete: 40 s.
- Erro 401/403: para de consultar até a tela fazer uma nova chamada à fila
  (token novo). Outro erro: espera 60 s e tenta de novo.
- Migração do som: quem está nos padrões antigos (`sirene-classica`,
  `toque-duplo`) passa para os novos uma vez; quem escolheu outro som mantém.
- Tempo de espera contado a partir da primeira vez que o script viu o
  `consultationId` (como no A); a aba recarregada recomeça a contagem.
