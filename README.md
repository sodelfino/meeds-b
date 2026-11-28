# Meeds B — Alarme de fila

Avisa o médico quando entra paciente no Pronto Atendimento do **Meeds Doctor**
(`doctor.calltechsaude.com.br`) — inclusive com a aba de fundo ou o navegador
minimizado, que é justamente quando o aviso da própria tela não é visto por
ninguém.

## ⚡ Instalar agora

| Onde você atende | Clique para instalar |
|---|---|
| 💻 **Computador ou Android** — Chrome, Edge ou Firefox, com a extensão [Tampermonkey](https://www.tampermonkey.net/) | **[➜ Instalar o Meeds B](https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.user.js)** |
| 📱 **iPad, iPhone ou Mac** — Safari, com o app gratuito [Userscripts](https://apps.apple.com/app/userscripts/id1463298887) | **[➜ Instalar a versão Safari](https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.user.js)** |

**No computador, em três passos:**

1. Instale o **Tampermonkey** pela loja do seu navegador (uma vez só).
2. Clique em **➜ Instalar o Meeds B**, acima, e depois em **Instalar** na tela do Tampermonkey.
3. Abra o Meeds Doctor (`doctor.calltechsaude.com.br`). O sino 🔔 aparece no canto inferior direito, e um cartão pergunta se você quer ser avisado também quando estiver em outro programa — diga **Sim, ativar**.

Depois disso ele **se atualiza sozinho**, e ao clicar no sino ele também confere se há versão nova.

> **Usa Edge?** Em **Configurações › Sistema e desempenho**, acrescente `doctor.calltechsaude.com.br` em *"Nunca colocar estes sites em suspensão"*. Aba dormindo não consulta a fila, e o alarme fica mudo.

📖 **Passo a passo completo** (Safari no iPad, ajuste do Edge, avisos do sistema, perguntas frequentes): [docs/INSTALACAO.md](docs/INSTALACAO.md)

As duas versões têm o mesmo código, byte a byte; só o cabeçalho muda.

---

## O problema

O Meeds Doctor já mostra um aviso quando chega paciente: um toast no canto
superior direito, "Novo paciente na fila". Ele funciona — enquanto o médico
estiver olhando para aquela aba.

Num plantão de teleconsulta ele quase nunca está. Está no Memed, no prontuário,
em outra janela. E o aviso mais bem desenhado do mundo não serve para nada se
mora só dentro de uma aba que ninguém está vendo.

## O que este script faz

Ele não substitui o aviso do app. Ele o **leva para onde o médico está**, numa
escada em que cada degrau muda de canal — não de volume:

| onde o médico está | como ele é avisado |
|---|---|
| na aba, olhando | som + faixa vermelha no topo + moldura na borda da tela |
| na aba, mas de fundo | contador no título e no ícone da aba: `(3) Meeds Doctor` |
| fora do navegador | **notificação do sistema, clicável** — traz a aba para frente |
| ninguém reagiu | volta em 1 minuto, e notifica de novo |

Clicar na notificação é "estou indo": traz a aba e silencia. Se o médico não
atender de fato, o alarme volta. É *acknowledge*, não *dismiss*.

### As três intensidades

O botão funciona como o de som do Waze: um toque cicla entre três posições, em
vez de só ligar e desligar. Um alarme com duas posições — berrando ou mudo —
obriga o médico a escolher entre ser interrompido no meio de uma consulta e não
ficar sabendo que chegou gente.

| | O que acontece quando chega paciente |
|---|---|
| 🔔 **Completo** | Sirene repetindo, faixa no topo e moldura na tela até você silenciar; se você silenciar e não atender, **volta a cada 1 min** |
| 🔉 **Discreto** | Um cartão no canto com a cidade de quem chegou, e um som curto que toca **duas vezes**. Some sozinho, e **volta a cada 1 min** se o paciente continuar esperando; aos 5 min de espera do mais antigo, sobe um degrau (faixa e moldura) |
| 🔕 **Silencioso** | Só o contador na aba e no favicone |

O aviso do sistema, o título e o favicone valem nos três: eles são sobre **onde**
avisar, não sobre o quanto incomodar.

Não existe mais uma chave separada de "alarme ligado": desligar de vez é
exatamente o que 🔕 Silencioso já faz. Para abrir os ajustes (som, volume,
janela de aviso), clique na ⚙️ ao lado do sino — clique direito ou
shift+clique no próprio sino também funcionam, para quem prefere.

A lista de sons muda junto com a intensidade. As sirenes foram feitas para
repetir e soam truncadas se tocadas uma vez só, então o modo discreto só oferece
os sons curtos — os que têm começo, meio e fim em menos de um segundo.


### A janela de aviso

Terceiro canal, opcional e desligado de fábrica. A notificação do sistema aparece
e some; a janela **fica** na barra de tarefas até alguém fechar. Para quem
trabalha com várias janelas e perde a notificação no canto, é a diferença entre
ver e não ver.

Ela só abre quando o médico está **fora** da aba, e nunca rouba o foco. Duas
razões para não ser padrão: o Chrome bloqueia pop-up não pedido por clique, e uma
janela que salta no meio de uma teleconsulta é pior que o problema que resolve.

Por isso, em vez de uma chave solta, o painel mostra um **cartão-convite**: ele
pergunta se o médico quer ser avisado quando estiver em outro programa e, no
"sim", abre a janela primeiro (o clique ainda vale para o Chrome) e só então pede
a permissão de notificação. Se o Chrome bloquear o pop-up, o cartão mostra o
passo a passo para liberar. Quem fechou o convite ou quer mudar de ideia volta
por **Configurar avisos fora da aba**, nos ajustes.

No iPad a opção nem aparece — lá o iOS abre uma *aba* por cima do site, e só a
partir de um gesto. Oferecer uma chave que não faz nada, com uma instrução de
desbloqueio que fala de um ícone que o iPad não tem, gasta o plantão e ensina a
desconfiar do resto do painel.

### A fila que se atualiza

O app do Meeds Doctor não atualiza a fila sozinho: ela só é buscada quando o
médico clica no menu, e um paciente já puxado por outro médico pode continuar na
tela por minutos. O script cuida disso:

- **Consulta de 15 s.** Só depois de a própria tela fazer a primeira chamada à
  fila, o script passa a consultar `/api/doctor/queues/mine` a cada 15 s, com a
  mesma URL e os mesmos cabeçalhos dela (uma chamada da tela sem `Authorization`
  não apaga o token já guardado). Consulta sem resposta em 10 s é abortada e conta
  como erro; qualquer erro espera 30 s. Resposta 401/403 suspende a consulta até a
  tela chamar de novo, e o painel de ajustes avisa: "A consulta automática da fila
  parou (sessão expirada?). Abra o Pronto atendimento para retomar."
- **Tempo de espera do servidor.** "O mais antigo há N min" vem do `waitingSince`
  de cada item, não do momento em que o script viu o paciente — recarregar a aba
  não zera a contagem.
- **Barra "A fila mudou".** Quando a consulta mostra que a fila mudou (outro
  médico atendeu, alguém saiu), uma barra no canto inferior esquerdo avisa e
  oferece **Atualizar fila**, que clica no menu "Pronto atendimento" do próprio
  app — se não achar o menu, a barra só some; a página nunca é recarregada. A
  barra some sozinha quando o contador sai da tela (o médico entrou numa consulta)
  e quando o "Atender" dá certo. Fica embaixo para não cobrir o banner do alarme.
- **Quem puxou primeiro.** O script escuta a resposta do "Atender" (`claim`): 2xx
  tira o paciente da conta; erro 4xx mostra "Outro médico já atendeu este
  paciente."

### Por que não pisca mais forte

Duas razões, nenhuma estética. A **WCAG 2.3.1** limita qualquer coisa a menos de
três flashes por segundo, por risco de crise fotossensível — as animações daqui
ficam perto de 1 Hz e somem inteiras com `prefers-reduced-motion`. E **fadiga de
alarme** é o problema clássico da categoria em saúde: alarme demais faz o
profissional ignorar o alarme, inclusive o que importava. Um alarme que incomoda
é um alarme desligado na segunda semana — e aí não há alarme nenhum.

Por isso o aviso também diz **por que** está tocando (`2 aguardando`) em vez de
só gritar.

## Como ele sabe que chegou paciente

Quatro sinais independentes, porque um sozinho é frágil:

| sinal | o que é | para quê |
|---|---|---|
| **A. Toast do app** | o "Novo paciente na fila" que o próprio Meeds Doctor emite | dispara |
| **B. Cartão "Aguardando"** | o número no topo do Pronto Atendimento — **só existe nessa tela** | conta, e diz quando parar |
| **C. `/api/doctor/queues/mine`** | a resposta que a tela busca ao navegar, e que o script também consulta a cada 15 s (ver "A fila que se atualiza") | dispara (entrada nova na fila), conta, e diz quando a fila esvaziou |
| **D. Clique em "Atender"** | o botão da linha de um paciente, na tela da fila | tira esse paciente da conta na hora |

### O que a gravação de 14/10 ensinou

O app **empurra a chegada** para a tela sem fazer requisição nenhuma: o contador
e o toast aparecem sozinhos. A própria tela só busca a fila (`/queues/mine`)
quando o médico clica no menu — por isso o script passou a consultá-la a cada
15 s, depois da primeira chamada da tela. E o cartão "Aguardando" não existe fora do Pronto Atendimento.

Consequência: **o alarme sabe pouco, e o pouco que sabe envelhece.** Ele foi
desenhado em volta disso:

- **Uma chegada nunca vale zero.** Se ninguém sabe quantos são (o médico está na
  Agenda), a chegada ainda é uma chegada — vale *pelo menos mais um* do que os
  já avisados. Contar um a menos deixa um paciente sem aviso nenhum: nem título,
  nem favicone, nem notificação do sistema, nem o lembrete agendado.
- **A rede é a única fonte que enxerga a fila vazia** com o cartão fora da tela.
  Uma resposta com a fila zerada cala o alarme, cancela os lembretes e limpa a aba.
- **Lembrete só toca com leitura fresca** (a regra D64, a mesma do Assistente
  Meeds: *abstenção não é prova de "ainda cheia"*). O contador "Aguardando" só
  existe na tela do Pronto Atendimento; fora dela o último número fica parado (é a consulta de 15 s que mantém a
  leitura fresca fora do Pronto Atendimento).
  Por isso o reengate de 1 min, o repique de 1 min do Discreto e o lembrete de
  quem já esperava **só soam se o contador foi lido há no máximo 40 s**. Sem
  leitura fresca, o lembrete pede a consulta na hora e decide pela resposta; se não
  dá para consultar (consulta ainda não capturada, ou suspensa por 401/403) ou ela
  falha, ele reagenda em silêncio, no mesmo ritmo — **não desiste**. Toda leitura
  com gente esperando garante que há um lembrete agendado. A corrente só morre com
  prova fresca de fila vazia.
- **Contador parado não é chegada.** A tela não se atualiza sozinha: um número
  "Aguardando" que não mudou desde a leitura anterior não vale como evidência
  quando a rede já leu depois dele. Depois de a consulta dizer "fila vazia", só uma
  *mudança* do contador (ou o aviso do próprio app) conta como chegada nova.
- **"Atender" clicado na fila** encerra o aviso desse paciente antes de a tela
  mudar. Só vale com o cartão na tela: na Agenda o mesmo botão atende uma consulta
  *marcada*, e contar esse clique tiraria da memória um paciente que ainda espera.
  Se o rótulo do botão mudar, esse sinal simplesmente para de agir.
- **Quem já esperava ao ligar** (aba recarregada, script atualizado) não dispara
  sirene — mas ganha lembrete. Sem isso, esperaria para sempre se ninguém novo
  chegasse.

A primeira leitura de cada fonte **nunca** dispara: ela só estabelece a base.
Sem isso, ligar o alarme com gente já esperando faria a sirene tocar para
pacientes que o médico já conhecia.

### Um paciente, um alarme

O toast, o contador (lido de 4 em 4 s) e a rede veem a **mesma** chegada em
momentos diferentes. Para isso não virar dois alarmes, o alarme mantém *quantos
já avisou*, e só dispara quando há **mais gente do que isso**:

- dentro de 10 s do último alarme, um sinal que não traz ninguém além dos já
  avisados é a mesma chegada;
- a rede desconta as chegadas que o toast e o contador já anunciaram — sem esse
  desconto, abrir o Pronto Atendimento (que busca a fila e traz o paciente que
  acabou de ser anunciado) fazia a sirene tocar de novo **justamente quando o
  médico chegava para atender**;
- um `0` do contador logo depois de um toast é atraso de renderização, não "a fila
  esvaziou" — mas um `0` da **rede** vale na hora.

Um limite assumido: se um paciente sai e outro entra em menos de 10 s, o segundo
pode tocar com até ~14 s de atraso. Entre tocar tarde e nunca tocar, o primeiro é
o erro barato.

### Uma decisão que vale explicar

No [Assistente Meeds](https://github.com/sodelfino/meeds-suite) a rede é o sinal
principal, porque o formato daquela API era conhecido. Aqui o DOM veio
primeiro, e por bom tempo: o **corpo** de `/queues/mine` só foi observado numa
gravação em 17/09 (a fila estava vazia naquele momento) — antes disso as
gravações guardavam corpo só de requisição com erro, e essa sempre respondeu
200.

O formato real é um **array de filas**, cada uma assim:

```json
{ "queue": { "id": "...", "careLine": "medica", "label": "Pronto atendimento" },
  "status": "ok", "items": [ /* pacientes daquela fila */ ], "stats": { "waiting": 0 } }
```

A leitura reconhece esse formato especificamente: só os ids de **dentro de
`items`** contam como paciente. Sem esse caso especial, o próprio `queue.id`
(que não tem nada aninhado com `id`) virava uma "folha" e era contado como se
fosse gente esperando — sempre presente, então nunca dispara um alarme
sozinho (o id da fila é estável entre polls), mas uma reconfiguração de fila
(nova especialidade, novo `careLineId`) pareceria "chegou paciente" com a
fila comprovadamente vazia.

Cada item é **uma entrada na fila**, e quem a identifica é o `consultationId`. O
`patient.id` é a *pessoa*: a mesma pessoa que sai e volta, ou é re-enfileirada,
é uma chegada nova com o mesmo `patient.id` — e seria silenciada se a chave
fosse esse.

Fora do formato reconhecido, a leitura de ids continua **deliberadamente
genérica**: colhe os ids das folhas do JSON, sem presumir nome de campo nenhum,
para qualquer formato ainda não visto. Já a **contagem** é o oposto, e estrita:
só sai número para o formato observado (`stats.waiting` de cada fila, que na
gravação bateu com `items.length` e com o cartão "Aguardando"). Qualquer outra
forma devolve *"não sei"* — que nunca é "zero". Contar por palpite num formato
nunca visto é exatamente o que mostraria "1 aguardando" com a fila zerada e
faria o alarme nunca parar.

Desenhar em cima do que se observou, e não do que se imagina, é o que separa um
alarme que funciona de um que só parece funcionar.

### Atualização

Ao clicar no sino, o alarme confere se existe versão mais nova (lê só o
cabeçalho `.meta.js` publicado, no máximo uma vez a cada 30 minutos). Se estiver
em dia, não aparece nada. Se houver versão nova, um cartão acima do sino pergunta
"Atualizar agora?"; o botão abre a tela de atualização do Tampermonkey (ou do app
Userscripts, no iPad) — quem confirma é você.

## Privacidade

- **O nome do paciente nunca é guardado, registrado, exibido nem enviado**, em
  nenhuma intensidade. O aviso fala em quantidade e tempo. Dizer "nunca é lido"
  seria prometer demais, e a revisão de 14/10 apontou isso: para achar o
  rótulo "Aguardando" ou "Novo", o script passa pelo texto das folhas vizinhas,
  e o toast chega com o nome dentro do próprio nó. Esse texto é só comparado com
  rótulos conhecidos, em memória, na hora — e nós com mais de 300 caracteres
  nem são examinados. A suíte (`tests/alarme-sinais.test.js`) procura o nome em
  tudo que o médico, ou uma tela compartilhada, pode ver, e em tudo que vai a
  disco.
- **Uma exceção deliberada:** o modo 🔉 Discreto mostra a **cidade** de quem
  acabou de chegar (o selo do cartão de fila, ex. "macae") — a mesma
  informação e pela mesma razão que o [Assistente
  Meeds](https://github.com/sodelfino/meeds-suite) já mostra lá: sustenta
  uma decisão real do médico (qual REMUME/laudo valem para aquele
  atendimento), e não é dado que identifique a pessoa. A leitura (ver
  `lerOrigemDoUltimoPaciente` em `src/fila.js`) **falha fechada**: só casa um
  selo minúsculo de uma palavra só, e devolve *nada* se houver mais de um
  candidato na mesma linha (um nome ou um chip de prioridade ao lado do selo) ou
  se duas linhas "Novo" tiverem cidades diferentes. O padrão, sozinho, não
  rejeita um nome digitado em minúsculas — por isso a regra é a ambiguidade, não
  a forma. **Risco que sobra:** uma linha com um único candidato minúsculo que
  seja um nome e nenhum selo ainda seria lida como cidade. Fechar isso exige uma
  lista fechada de cidades ou o `tenantId` (ou `patient.locality`) da
  resposta da fila, que agora chega a cada 15 s — é decisão de produto. A cidade lida vive só em memória
  (`ultimaOrigem`), nunca em disco, e morre com a aba.
- Os ids de atendimento vivem em memória e morrem com a aba.
- Em disco vão só as preferências do médico: intensidade, som, volume, se
  a janela de aviso está ligada e se o cartão-convite já foi respondido.
- O script faz uma única consulta de leitura, à fila do médico logado
  (`/api/doctor/queues/mine`), a cada 15 s. O cabeçalho de acesso é copiado da
  chamada que a própria tela fez e vive só em memória. A outra requisição é a
  verificação de versão ao clicar no sino: um GET do cabeçalho `.meta.js` no
  GitHub, sem cookies e sem dado nenhum do médico ou do paciente.
- Uma notificação do sistema aparece na tela de bloqueio e no histórico de
  notificações do computador, fora do navegador. É o pior lugar possível para um
  dado de paciente — por isso nenhum vai para lá.

## Desenvolvimento

```bash
npm run verificar   # os dois cabeçalhos, dado sensível, e as dez suítes de teste
npm run build       # gera os 4 arquivos em dist/ (Tampermonkey + Safari)
```

Para testar sem tocar em produção, sirva a pasta e abra `tests/smoke.html` — ela
imita o Pronto Atendimento com os rótulos reais, o toast do app e um mock de
`/api/doctor/queues/mine`, com botões para disparar cada sinal isoladamente.

```bash
npx http-server -p 8741 -c-1 .
```

Estrutura:

```
src/atencao.js   por onde avisar (título, favicone, notificação, tela acesa)
src/atualizacao.js  confere se há versão nova (ao clicar no sino, no máximo a cada 30 min)
src/visual.js    o visual do painel (cabeçalho branco, sino em SVG), igual ao Assistente Meeds
src/convite.js   o cartão-convite dos avisos fora da aba e o passo a passo do pop-up
src/som.js       os sons, sintetizados — sem arquivo externo
                 (os que repetem e os curtos; ver o campo `curto`); o padrão
                 é o "Alerta (3 notas)"
src/fila.js      como saber que chegou paciente NESTE site
src/alarme.js    a lógica e a interface
scripts/build.js junta tudo num userscript só
tests/           atencao, fila, som, visual, convite e atualizacao: um módulo cada
                 alarme.test.js, alarme-sinais.test.js, alarme-reengate.test.js e
                 alarme-consulta.test.js: o alarme INTEIRO, rodando os fontes de
                 verdade com relógio, tela e rede falsos
tests/helpers/   ambiente-alarme.js, o "navegador" dessas suítes
```

### Por que existem `alarme.test.js` e `alarme-sinais.test.js`

Até a v1.4.0 o arquivo que decide *se o médico é avisado* — `src/alarme.js` —
não tinha teste nenhum. Os três que existiam cobriam a leitura da fila, o som e
a escada de atenção, mas não o que junta tudo, e é aí que moram os defeitos do
tipo "paciente preso": um timer cancelado por uma função com "parar" no nome,
um contador que ninguém zera, um sinal que chega duas vezes. Nenhum teste de
unidade de um módulo isolado enxerga isso.

Os cenários descrevem o comportamento **correto** segundo este README, e a suíte
foi validada por mutação: reintroduzir cada defeito conhecido, um por vez, tem
que fazê-la falhar. Se você "consertar" o alarme e um teste quebrar, leia o
comentário do cenário antes de mexer no teste — vários existem para impedir uma
correção óbvia e errada (por exemplo, absorver uma leitura "repetida" parece
resolver a duplicidade e engole o segundo paciente para sempre).

`src/atencao.js` e `src/som.js` vieram do
[Assistente Meeds](https://github.com/sodelfino/meeds-suite), e `src/visual.js`
copia o cabeçalho e os ícones de lá; é tudo o que os dois projetos compartilham. São genéricos de propósito: não sabem o
que é fila nem o que é paciente. Tudo que é específico deste site mora em
`src/fila.js` — é lá que se mexe quando o Meeds Doctor mudar de layout.
