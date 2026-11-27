# Meeds B 1.6 — Lembrete de 1 min, som novo, fila que se atualiza e convite da janela — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tornar o alarme do Meeds B ativo o plantão todo: lembrete a cada 1 min com som de alerta novo, contagem válida em qualquer tela (consulta própria da fila), aviso de "fila mudou", tempo de espera no aviso, convite guiado para a janela de aviso e o visual do Assistente Meeds.

**Architecture:** Evolui os 4 fontes atuais (`src/atencao.js`, `src/som.js`, `src/fila.js`, `src/alarme.js`) e acrescenta dois pequenos: `src/visual.js` (CSS/SVG copiados do meeds-suite) e `src/convite.js` (o cartão de passos). `scripts/build.js` concatena tudo num userscript. A consulta própria reaproveita `aoResponderFila()` — a mesma porta por onde já entra a resposta que a tela busca.

**Tech Stack:** JavaScript ES5 sem dependências (userscript Tampermonkey/Safari), Web Audio, testes em Node com `vm` (`tests/helpers/ambiente-alarme.js`).

**Spec:** `docs/superpowers/specs/2026-11-27-lembrete-1min-design.md`

## Global Constraints

- Node ≥ 14; nenhuma dependência nova; ES5 nos fontes (`var`, `function`) como o código existente.
- Nada de paciente nem token em disco: só preferências (`GM_setValue`/`localStorage` via `gravar()`).
- Consulta própria: só `GET` em `/api/doctor/queues/mine`, a cada **15 000 ms**, nunca duas ao mesmo tempo.
- Frescor aceito para lembrete soar: **40 000 ms** (`LIMITE_FRESCOR_CONTADOR_MS`).
- Lembrete: **60 000 ms** no Completo (reengate) e no Discreto (repique).
- Degrau de escalada: espera do mais antigo **≥ 300 000 ms** (5 min).
- Textos em pt-BR, sem jargão; o nome do paciente nunca aparece em nada visível.
- `npm run verificar` passa ao fim de cada task (acrescente cada arquivo de teste novo ao script `verificar` do `package.json`).
- Todo fonte novo entra em `FONTES` de `scripts/build.js` **e** de `tests/helpers/ambiente-alarme.js`, na ordem: `atencao, som, fila, visual, convite, alarme`.

## Review Focus

1. **Token expira no meio do plantão** → a consulta recebe 401 e para, sem laço; volta sozinha quando a tela faz nova chamada à fila. (Task 2, teste `401 suspende e a tela retoma`)
2. **Servidor lento / aba em segundo plano** → uma consulta pendurada não dispara outra por cima. (Task 2, teste `sem sobreposicao`)
3. **Médico clica "Atender" e a consulta seguinte ainda traz o paciente** → não toca de novo como chegada. (Task 2, teste `atender e eco atrasado da consulta`)
4. **Pop-up bloqueado no teste do convite** → mostra o passo a passo e a janela continua desligada. (Task 6, teste `janela bloqueada ensina`)
5. **Resposta da fila em formato desconhecido** (`contagemDaFila` → `null`) → o lembrete não soa às cegas, mas também não morre. (Task 3, teste `formato desconhecido nao toca nem desiste`)

---

### Task 1: Som de alerta de 3 notas como padrão

**Files:**
- Modify: `src/som.js` (acrescentar dois sons ao `TIPOS_DE_SOM`)
- Modify: `src/alarme.js:45-51` (`PADRAO`) e `carregarConfig()` (migração)
- Test: `tests/som.test.js`, `tests/alarme.test.js`

**Interfaces:**
- Produces: sons `"alerta-3-notas"` (`curto:false`, `intervaloMs:2400`) e `"alerta-3-notas-curto"` (`curto:true`, `intervaloMs:1400`); `PADRAO.som = "alerta-3-notas"`, `PADRAO.somCurto = "alerta-3-notas-curto"`; campo novo `config.padraoV` (número).
- Produces (helper de teste, usado pelas Tasks 2 e 6): `criarAmbiente({ guardado })` / `ligar({ guardado })` pré-carrega a preferência gravada (um `GM_getValue`/`GM_setValue` falso sobre um objeto); `A.disco()` devolve esse objeto; `A.config()` devolve o `config` atual (exponha-o em `MeedsB._estado()`).

- [ ] **Step 1: Testes que falham**

Em `tests/som.test.js`:
```js
ok("alerta-3-notas existe e repete", SONS["alerta-3-notas"] && SONS["alerta-3-notas"].curto === false);
ok("alerta-3-notas-curto existe e e curto", SONS["alerta-3-notas-curto"] && SONS["alerta-3-notas-curto"].curto === true);
ok("alerta repete no maximo a cada 2,4 s", SONS["alerta-3-notas"].intervaloMs === 2400);
```
Em `tests/alarme.test.js` (com `criarAmbiente({ guardado })`; se o helper não aceitar config gravada, acrescente essa opção a ele):
```js
// quem estava nos padroes antigos migra uma vez
A = ligar({ guardado: { som: "sirene-classica", somCurto: "toque-duplo", intensidade: "completo" } });
ok("migra som padrao antigo", A.config().som === "alerta-3-notas" && A.config().somCurto === "alerta-3-notas-curto");
// quem escolheu outro som mantem
A = ligar({ guardado: { som: "campainha", somCurto: "gota", intensidade: "completo" } });
ok("mantem escolha do medico", A.config().som === "campainha" && A.config().somCurto === "gota");
// a migracao nao repete: padraoV 2 com sirene-classica e escolha consciente
A = ligar({ guardado: { som: "sirene-classica", somCurto: "toque-duplo", padraoV: 2 } });
ok("nao migra duas vezes", A.config().som === "sirene-classica");
```
(Use os ids reais de som curto existentes em `src/som.js` para "gota"; `A.config()` lê `MeedsB._estado()` — exponha `config` inteiro em `_estado` se preciso.)

- [ ] **Step 2: Rodar e ver falhar** — `node tests/som.test.js && node tests/alarme.test.js` → FALHA nos itens acima.

- [ ] **Step 3: Implementar**

Em `src/som.js`, uma função interna `tocarAlerta3Notas(ctx, volume)` compartilhada pelos dois sons: três pulsos de 150 ms com início em 0 / 0,2 / 0,4 s, notas **659,25 / 880 / 1108,73 Hz**, onda `triangle` + harmônico `sine` no dobro da frequência com 30 % do ganho, ganho de pico `0.32 * volume`, rampa de 10 ms de subida e `exponentialRampToValueAtTime(0.001, …)` no fim de cada pulso (sem estalo). `nome`: "Alerta (3 notas)" e "Alerta curto (3 notas)".
Em `carregarConfig()`: se `guardado.padraoV !== 2` e `guardado.som === "sirene-classica"` → usa `PADRAO.som`; idem `somCurto === "toque-duplo"` → `PADRAO.somCurto`. Grave `padraoV: 2` no `config`.

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar` → "todos passaram".

- [ ] **Step 5: Commit**
```bash
git add src/som.js src/alarme.js tests/som.test.js tests/alarme.test.js tests/helpers/ambiente-alarme.js
git commit -m "feat(som): alerta de 3 notas como padrao, com migracao de quem usava o antigo"
```

---

### Task 2: Consulta própria da fila a cada 15 s

**Files:**
- Modify: `src/alarme.js` (`instalarEscutaDeRede()`, `aoResponderFila()`, `iniciar()`, constante de frescor)
- Modify: `tests/helpers/ambiente-alarme.js` (fetch falso)
- Create: `tests/alarme-consulta.test.js`

**Interfaces:**
- Consumes: `Fila.ehChamadaDaFila(url)`, `Fila.idsDeFolhas(json)`, `Fila.contagemDaFila(json)` (já existem).
- Produces:
  - `aoResponderFila(json, origem)` — `origem` é `"tela"` (o gancho) ou `"consulta"` (a nossa). Exposto em teste como `MeedsB._aoResponderFila(json, origem)`.
  - `consultarFilaAgora() -> void` e constantes `INTERVALO_CONSULTA_MS = 15000`, `ESPERA_APOS_ERRO_MS = 60000`.
  - Estado em memória: `cabecalhosDaFila` (objeto simples nome→valor, copiado da última chamada do app), `urlDaFila` (URL absoluta da última chamada do app; padrão `location.origin + "/api/doctor/queues/mine"`), `consultaSuspensa` (bool), `consultaEmAndamento` (bool).
  - Helper de teste: `A.respostasDeFetch` (fila de `{status, corpo}` ou `"pendurar"`), `A.chamadasDeFetch` (array `{url, opcoes}`), `A.appBuscaFila(corpo, {headers})` simula a tela chamando a fila via XHR com `setRequestHeader`.

- [ ] **Step 1: Testes que falham** em `tests/alarme-consulta.test.js` (mesmo estilo `ok(nome, cond)` dos outros):
  - `faz GET sozinho apos 15 s`: `ligar()`; `A.avancar(15000)` → `A.chamadasDeFetch.length === 1`, url termina em `/api/doctor/queues/mine`, `opcoes.credentials === "include"`, método ausente ou `"GET"`.
  - `reusa cabecalho do app, so em memoria`: `A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer T" } })`; `A.avancar(15000)` → `chamadasDeFetch[0].opcoes.headers.Authorization === "Bearer T"`; e `JSON.stringify(A.disco())` não contém `"Bearer"`.
  - `401 suspende e a tela retoma`: resposta `{status:401}`; `A.avancar(60000)` → só 1 chamada; `A.appBuscaFila(...)`; `A.avancar(15000)` → 2 chamadas.
  - `erro 500 espera 60 s`: `{status:500}` → nenhuma chamada nova em `A.avancar(59000)`; uma em `A.avancar(1000)`.
  - `sem sobreposicao`: primeira resposta `"pendurar"`; `A.avancar(60000)` → `chamadasDeFetch.length === 1`.
  - `fila vazia pela consulta cala o alarme`: alarme tocando (Completo, 1 paciente); consulta responde `filaReal([])` → `!A.estado().tocando`, nenhum lembrete em `A.avancar(120000)`.
  - `atender e eco atrasado da consulta`: 1 paciente avisado; `A.clicarNaPagina(A.botao("Atender"))`; consulta traz o mesmo `consultationId` → `A.sons.length` não aumenta.
  - `a consulta propria nao passa pelo gancho`: depois de uma consulta, a resposta não é processada duas vezes (contagem de chamadas a `aoResponderFila` com `origem === "tela"` continua 0 — exponha um contador em `_estado()` ou espie via log de debug).

- [ ] **Step 2: Rodar e ver falhar** — `node tests/alarme-consulta.test.js` → FALHAS.

- [ ] **Step 3: Implementar**
  - No gancho de `fetch`: quando `Fila.ehChamadaDaFila(url)`, guarde `urlDaFila` (absoluta) e copie os cabeçalhos de `opcoes.headers` (aceite `Headers`, array de pares ou objeto) ou de `entrada.headers` quando `entrada` for `Request`; zere `consultaSuspensa`. No XHR: embrulhe `setRequestHeader` para anotar os cabeçalhos no próprio objeto e copie-os no `send` quando a URL for da fila. Chame `aoResponderFila(json, "tela")`.
  - Guarde `fetchOriginal` numa variável do closure; `consultarFilaAgora()` usa **ela** (nunca `raiz.fetch`), com `{ method: "GET", credentials: "include", cache: "no-store", headers: cabecalhosDaFila || {} }`. Se `consultaEmAndamento` ou `consultaSuspensa` → só reagenda. `ok` → `aoResponderFila(json, "consulta")` e reagenda em 15 s; 401/403 → `consultaSuspensa = true` (sem reagendar até o gancho ver nova chamada, que reagenda); outro erro/exceção → reagenda em 60 s. Encadeie com `setTimeout`, nunca `setInterval`.
  - `iniciar()`: agenda a primeira consulta em 15 s.
  - `LIMITE_FRESCOR_CONTADOR_MS = 40000` (comentário de uma linha: a consulta de 15 s é a fonte fresca fora do Pronto Atendimento).

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar` (incluindo o teste novo no script) → "todos passaram". Testes antigos que dependiam do frescor de 12 s: ajuste a constante deles para 40 000.

- [ ] **Step 5: Commit**
```bash
git add src/alarme.js tests/alarme-consulta.test.js tests/helpers/ambiente-alarme.js tests/alarme-reengate.test.js package.json
git commit -m "feat(fila): consulta propria da fila a cada 15 s, so leitura e so em memoria"
```

---

### Task 3: Lembrete a cada 1 min, tempo de espera e degrau aos 5 min

**Files:**
- Modify: `src/alarme.js` (`REENGATE_MS`, `INTERVALO_REPIQUE_DISCRETO_MS`, `aoResponderFila`, `textoDoMotivo`, `dispararAlarme`)
- Test: `tests/alarme.test.js`, `tests/alarme-reengate.test.js`, `tests/alarme-consulta.test.js`

**Interfaces:**
- Consumes: `aoResponderFila(json, origem)` da Task 2.
- Produces: `vistoDesde` (mapa id→ms, só memória); `esperaDoMaisAntigoMs() -> number | null`; `REENGATE_MS = 60000`; `INTERVALO_REPIQUE_DISCRETO_MS = 60000`; `DEGRAU_ESPERA_MS = 300000`.

- [ ] **Step 1: Testes que falham**
  - Em `alarme-reengate.test.js`: `REENGATE_MS = 60000` (o teste existente passa a provar 1 min).
  - Em `alarme.test.js`, troque as expectativas de repique de 2 min por 1 min.
  - Em `alarme-consulta.test.js`:
    - `discreto lembra a cada 1 min fora do PA`: Discreto, `A.mostrarTela(telaSemContador())`, consulta sempre com 1 paciente; após a chegada, `A.avancar(60000)` → +1 som; `A.avancar(60000)` → +1 som.
    - `aviso traz a espera do mais antigo`: mesmo cenário, `A.avancar(4 * 60000)` → `A.cartao().titulo` ou `A.motivoDoBanner()` contém `"o mais antigo há 4 min"`.
    - `degrau aos 5 min no discreto`: `A.avancar(5 * 60000)` → `A.bannerVisivel() === true` no Discreto.
    - `formato desconhecido nao toca nem desiste`: consulta passa a responder `{ outra: "coisa" }` com o contador fora da tela → nenhum som em `A.avancar(180000)`; voltando a responder `filaReal([p])` → som no próximo minuto.
    - `silencioso continua mudo`: Silencioso, 1 paciente, `A.avancar(300000)` → `A.sons.length === 0`.

- [ ] **Step 2: Rodar e ver falhar** — `npm run verificar` → FALHAS nos itens acima.

- [ ] **Step 3: Implementar**
  - Constantes de 60 000 ms e `DEGRAU_ESPERA_MS`.
  - Em `aoResponderFila`: para cada id atual, `vistoDesde[id] = vistoDesde[id] || chegada`, em que `chegada = Date.parse(item.checkedInAt)` quando o item da fila trouxer `checkedInAt` válido (campo real do servidor, visto na gravação de 17/09), senão `Date.now()`; apague os ids que sumiram. Isso exige ler o item junto com o id — acrescente em `src/fila.js` uma função `chegadasDaFila(json) -> Array<{ id: string, chegadaMs: number|null }>` só para o formato reconhecido (array de `{ queue, items }`, id = `consultationId` ou `id` do item, como `chaveDoItem` já faz), devolvendo `[]` para outro formato. Teste extra: `checkedInAt de 7 min atras ja aparece como 7 min` na primeira resposta. `esperaDoMaisAntigoMs()` = `Date.now() - min(vistoDesde)` ou `null` se vazio.
  - `textoDoMotivo()`: quando a espera ≥ 60 000, acrescente `" · o mais antigo há " + Math.floor(ms/60000) + " min"`.
  - `dispararAlarme("ainda-aguardando")` no Discreto com espera ≥ `DEGRAU_ESPERA_MS`: mostra também `elBanner` e `elMoldura` (som continua o curto). Os mesmos elementos somem no `silenciarAlarme()` já existente.

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar` → "todos passaram".

- [ ] **Step 5: Commit**
```bash
git add src/alarme.js tests/
git commit -m "feat(alarme): lembrete a cada 1 min, espera do mais antigo e degrau aos 5 min"
```

---

### Task 4: Barra "A fila mudou" com "Atualizar fila"

**Files:**
- Modify: `src/fila.js` (nova função), `src/alarme.js` (barra na UI + regra)
- Test: `tests/fila.test.js`, `tests/alarme-consulta.test.js`

**Interfaces:**
- Consumes: `aoResponderFila(json, origem)` (Task 2).
- Produces: `Fila.clicarMenuProntoAtendimento() -> boolean` (acha `a`/`button`/`[role=link]` cujo `Fila.normalizar(textContent) === "pronto atendimento"`, chama `.click()`, devolve `true`; senão `false`). Elementos no shadow: `#mb-fila-mudou` (com `hidden`), texto "A fila mudou — outro médico pode ter atendido.", botão `#mb-atualizar-fila` "Atualizar fila".

- [ ] **Step 1: Testes que falham**
  - `fila.test.js`: com uma tela de mentira contendo o item de menu "Pronto atendimento" → `clicarMenuProntoAtendimento() === true` e o clique foi registrado; sem o item → `false`.
  - `alarme-consulta.test.js`:
    - `paciente saiu, na tela da fila: barra aparece`: consulta com `[p1, p2]`, depois `[p2]`, tela com contador → `!A.stub("mb-fila-mudou").hidden`.
    - `na agenda a barra nao aparece`: mesmo, com `telaSemContador()` → continua `hidden`.
    - `clicar atualiza pelo menu`: `A.clicar("mb-atualizar-fila")` → menu clicado, barra `hidden`.
    - `resposta da tela esconde a barra`: `A.appBuscaFila(...)` → barra `hidden`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** — em `aoResponderFila`, com `origem === "consulta"`, base existente, algum id de `idsVistos` ausente em `atual` e `Fila.lerContadorAguardando() !== null` → mostra a barra; com `origem === "tela"` → esconde. Clique: `if (!Fila.clicarMenuProntoAtendimento()) raiz.location.reload();` e esconde a barra. Nunca clique sem o médico pedir.

- [ ] **Step 3b: Escuta do "Atender" pela rede (gravação de 17/09)** — "Atender" chama `POST https://api.calltechsaude.com.br/api/doctor/consultations/{id}/claim`. Acrescente `Fila.ehChamadaDeClaim(url, metodo) -> boolean` (POST e caminho terminando em `/claim` sob `/api/doctor/consultations/`). No gancho de XHR/fetch existente: resposta **2xx** → `aoMedicoAtender()` (o clique no botão continua como reforço, mas um mesmo atendimento não pode descontar dois pacientes: guarde o id do último claim atendido e ignore o clique se veio nos últimos 3 s); resposta **4xx** → mostra a barra `#mb-fila-mudou` com o texto "Outro médico já atendeu este paciente." e o mesmo botão "Atualizar fila". Testes em `alarme-consulta.test.js`: `claim 201 tira um da conta`, `claim 409 mostra aviso de outro medico`, `clique + claim nao descontam dois`; em `fila.test.js`: `ehChamadaDeClaim` aceita o POST e recusa GET e `/start`.

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar`.

- [ ] **Step 5: Commit**
```bash
git add src/fila.js src/alarme.js tests/
git commit -m "feat(fila): barra 'a fila mudou' e aviso de paciente ja puxado por outro medico"
```

---

### Task 5: Visual do Assistente Meeds (cabeçalho branco e sino em SVG)

**Files:**
- Create: `src/visual.js`
- Modify: `src/alarme.js` (`CSS`, `montarUI()`, troca do emoji do botão do sino), `scripts/build.js` e `tests/helpers/ambiente-alarme.js` (`FONTES`)
- Test: `tests/visual.test.js`

**Interfaces:**
- Produces: `raiz.MeedsBVisual = { CSS: string, cabecalho({ titulo, subtitulo, idFechar }) -> string, sino(intensidade) -> string }`. `CSS` e o HTML do cabeçalho são copiados de `../meeds-suite/core/cabecalho.js` (classes `msc-*`, tom `alarme` `#b42318`, fundo do ícone `#fff4e6`); os SVGs `sino`, `sino-baixo`, `sino-mudo` de `../meeds-suite/core/icones.js`, mapeados para `completo`, `discreto`, `silencioso`.

- [ ] **Step 1: Teste que falha** (`tests/visual.test.js`, carrega só `src/visual.js` num `vm`):
```js
["completo", "discreto", "silencioso"].forEach(function (i) {
  ok("sino " + i + " e svg", /^<svg[\s\S]*<\/svg>$/.test(V.sino(i)));
});
ok("intensidade invalida cai no completo", V.sino("x") === V.sino("completo"));
ok("cabecalho escapa titulo", V.cabecalho({ titulo: "<b>", idFechar: "f" }).indexOf("&lt;b&gt;") > -1);
ok("cabecalho usa o id do fechar", V.cabecalho({ titulo: "t", idFechar: "mb-fechar" }).indexOf('id="mb-fechar"') > -1);
```

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** `src/visual.js` e usar no painel de ajustes (cabeçalho "Alarme de fila", subtítulo com a intensidade) e no botão do sino. Mantenha os ids que o resto do código e os testes já usam. Acrescente `visual.js` aos dois `FONTES`.

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar`; abrir `tests/smoke.html` (`npx http-server -p 8741 -c-1 .`) e conferir o sino e o painel no navegador.

- [ ] **Step 5: Commit**
```bash
git add src/visual.js src/alarme.js scripts/build.js tests/ package.json
git commit -m "feat(visual): cabecalho branco e sino em SVG, iguais ao Assistente Meeds"
```

---

### Task 6: Convite guiado para os avisos fora da aba

**Files:**
- Create: `src/convite.js`
- Modify: `src/alarme.js` (abrir o convite no início e pelo painel; campo `config.convite`), `scripts/build.js` e `tests/helpers/ambiente-alarme.js` (`FONTES`)
- Test: `tests/convite.test.js`

**Interfaces:**
- Consumes: `Atencao.suportaJanela()`, `Atencao.abrirJanelaDeAviso(opcoes) -> Window|null`, `Atencao.fecharJanelaDeAviso()`, `Atencao.suportaNotificacao()`, `Atencao.permissaoDeNotificacao()`, `Atencao.pedirPermissaoDeNotificacao() -> Promise<boolean>`; `MeedsBVisual.cabecalho` (Task 5).
- Produces: `raiz.MeedsBConvite.criar({ shadow, Atencao, aoConcluir }) -> { abrir(), fechar(), passo() }`, em que `passo()` ∈ `"convite" | "janela-bloqueada" | "pronto" | null` e `aoConcluir({ janela: boolean, visto: true })`. `config.convite` ∈ `"pendente" | "visto"` (padrão `"pendente"`). Ids: `#mb-convite`, `#mb-convite-sim`, `#mb-convite-nao`, `#mb-convite-testar`, `#mb-convite-seguir`, `#mb-convite-fechar`; botão no painel `#mb-convite-abrir` "Configurar avisos fora da aba". Teste: `MeedsB._passoDoConvite()`.

Textos (copy fixada):
- Convite — título "Ser avisado fora do Meeds?"; corpo "Quando chegar paciente e você estiver em outro programa, o Meeds pode mostrar um aviso do sistema e deixar uma janelinha na barra de tarefas até você voltar."; botões "Sim, ativar" / "Agora não".
- Janela bloqueada — título "O navegador bloqueou a janela"; passos: "1. Na barra de endereço, à direita, clique no ícone de janela bloqueada." "2. Escolha \"Sempre permitir pop-ups e redirecionamentos de doctor.calltechsaude.com.br\" e clique em Concluído." "3. Clique em Testar de novo."; botões "Testar de novo" / "Seguir sem a janela".
- Pronto — título "Avisos ligados"; se a notificação estiver negada, acrescentar "As notificações estão bloqueadas: clique no cadeado da barra de endereço → Notificações → Permitir."; botão "Fechar".

- [ ] **Step 1: Testes que falham** (`tests/convite.test.js`, via `ligar()`):
  - `aparece uma vez`: `config.convite` pendente, Completo → `A.avancar(3000)` → `_passoDoConvite() === "convite"`.
  - `silencioso nao convida`: intensidade Silencioso → passo `null` após 3 s.
  - `agora nao grava e nao volta`: clicar `mb-convite-nao` → passo `null`, `A.disco()` tem `convite: "visto"`; recarregar com esse disco → passo `null`.
  - `sim com janela ok liga a janela`: `window.open` falso devolve janela → clicar `mb-convite-sim` → passo `"pronto"`, `config.janela === true`.
  - `abre a janela antes de pedir notificacao`: registre a ordem das chamadas → `open` vem antes de `requestPermission` (a janela precisa do clique ainda "quente").
  - `janela bloqueada ensina`: `open` devolve `null` → passo `"janela-bloqueada"`, `config.janela === false`; com `open` ok, clicar `mb-convite-testar` → `"pronto"`, `config.janela === true`.
  - `ipad pula a janela`: user agent de iPad com toque → após "Sim", passo `"pronto"` e `open` nunca chamado.
  - `painel reabre`: com `convite: "visto"`, clicar `mb-convite-abrir` → passo `"convite"`.

- [ ] **Step 2: Rodar e ver falhar.**

- [ ] **Step 3: Implementar** `src/convite.js` (cartão no shadow, foco no primeiro botão, `Esc` fecha como "Agora não", `role="dialog"` com `aria-labelledby`). No "Sim": **primeiro** `Atencao.abrirJanelaDeAviso({ titulo: "Teste da janela de aviso", corpo: "Pode fechar. Quando chegar paciente, ela aparece aqui." })` (se `suportaJanela()`), fecha em 3 s; **depois** `pedirPermissaoDeNotificacao()`. Em `alarme.js`: carregar/gravar `convite`, abrir 3 s após `montarUI()` se `"pendente"` e intensidade ≠ Silencioso; `aoConcluir` grava `janela` e `convite: "visto"` e chama `refletirJanela()`. Acrescente `convite.js` aos dois `FONTES`.

- [ ] **Step 4: Rodar e ver passar** — `npm run verificar`; no `tests/smoke.html`, conferir o cartão, o bloqueio de pop-up do Chrome e o "Testar de novo".

- [ ] **Step 5: Commit**
```bash
git add src/convite.js src/alarme.js scripts/build.js tests/ package.json
git commit -m "feat(convite): pergunta antes de ligar a janela de aviso e ensina a liberar o pop-up"
```

---

### Task 7: Versão 1.6.0, README e build

**Files:**
- Modify: `package.json` (`version: "1.6.0"`), `README.md`, `dist/*` (gerado)

- [ ] **Step 1: README** — na tabela das intensidades: lembrete "a cada 1 min" (Completo e Discreto) e degrau aos 5 min; trocar "volta em 5 minutos" por "volta em 1 minuto"; seção nova "A fila que se atualiza" (consulta de 15 s, barra "a fila mudou"); em Privacidade, substituir "O script não faz requisição própria" por: "O script faz uma única consulta de leitura, à fila do médico logado (`/api/doctor/queues/mine`), a cada 15 s. O cabeçalho de acesso é copiado da chamada que a própria tela fez e vive só em memória."; seção "A janela de aviso" descrevendo o convite; atualizar a estrutura de arquivos com `visual.js` e `convite.js`.
- [ ] **Step 2: Build e verificação** — `npm run build && npm run verificar` → "todos passaram"; `grep -c "@version      1.6.0" dist/meeds-b.user.js dist/meeds-b.safari.user.js` → `1` em cada.
- [ ] **Step 3: Commit**
```bash
git add package.json README.md dist/
git commit -m "chore(release): 1.6.0 — lembrete de 1 min, som novo, fila que se atualiza e convite da janela"
```
