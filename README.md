# Meeds B — Alarme de fila

Avisa o médico quando entra paciente no Pronto Atendimento do **Meeds Doctor**
(`doctor.calltechsaude.com.br`) — inclusive com a aba de fundo ou o navegador
minimizado, que é justamente quando o aviso da própria tela não é visto por
ninguém.

Instalação em [docs/INSTALACAO.md](docs/INSTALACAO.md).

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
| ninguém reagiu | volta em 5 minutos, e notifica de novo |

Clicar na notificação é "estou indo": traz a aba e silencia. Se o médico não
atender de fato, o alarme volta. É *acknowledge*, não *dismiss*.

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

Três sinais independentes, porque um sozinho é frágil:

| sinal | o que é | para quê |
|---|---|---|
| **A. Toast do app** | o "Novo paciente na fila" que o próprio Meeds Doctor emite | dispara |
| **B. Cartão "Aguardando"** | o número no topo do Pronto Atendimento | conta, e diz quando parar |
| **C. `/api/doctor/queues/mine`** | a resposta que a própria tela já busca | dispara (id novo) |

A primeira leitura de cada fonte **nunca** dispara: ela só estabelece a base.
Sem isso, ligar o alarme com gente já esperando faria a sirene tocar para
pacientes que o médico já conhecia.

O toast e a rede podem apontar a mesma chegada; uma janela de 2,5 s garante que
isso vire **um** alarme, não dois.

### Uma decisão que vale explicar

No [Assistente Meeds](https://github.com/sodelfino/meeds-suite) a rede é o sinal
principal, porque o formato daquela API era conhecido. Aqui é o contrário: o
**corpo** de `/queues/mine` nunca foi observado — as gravações guardam corpo
apenas de requisição com erro, e essa sempre respondeu 200. O DOM, esse foi
observado inteiro.

Então o DOM vem primeiro, e a leitura da rede é **deliberadamente genérica**:
colhe os ids das folhas do JSON, sem presumir nome de campo nenhum. Ela detecta
*chegada*, nunca fornece a *contagem* — uma fila vazia ainda é um objeto com
`id`, e contar por ali mostraria "1 aguardando" com a fila zerada, fazendo o
alarme nunca parar.

Desenhar em cima do que se observou, e não do que se imagina, é o que separa um
alarme que funciona de um que só parece funcionar.

## Privacidade

- **Nenhum dado de paciente é lido, gravado ou exibido.** O aviso fala em
  quantidade e tempo — nunca em gente.
- Os ids de atendimento vivem em memória e morrem com a aba.
- Em disco vão só as preferências do médico: ligado, som, volume.
- O script **não faz requisição própria**. Ele lê respostas que a própria tela
  já buscou, e `/queues/mine` é, por definição, a fila do médico logado.
- Uma notificação do sistema aparece na tela de bloqueio e no histórico de
  notificações do computador, fora do navegador. É o pior lugar possível para um
  dado de paciente — por isso nenhum vai para lá.

## Desenvolvimento

```bash
npm run verificar   # cabeçalho, dado sensível, e as duas suítes de teste
npm run build       # gera dist/meeds-b.user.js e o .meta.js
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
src/som.js       os quatro sons, sintetizados — sem arquivo externo
src/fila.js      como saber que chegou paciente NESTE site
src/alarme.js    a lógica e a interface
scripts/build.js junta tudo num userscript só
```

`src/atencao.js` e `src/som.js` vieram do
[Assistente Meeds](https://github.com/sodelfino/meeds-suite) e são a única coisa
compartilhada entre os dois projetos. São genéricos de propósito: não sabem o
que é fila nem o que é paciente. Tudo que é específico deste site mora em
`src/fila.js` — é lá que se mexe quando o Meeds Doctor mudar de layout.
