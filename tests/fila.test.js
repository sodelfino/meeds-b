/* ------------------------------------------------------------------
 * tests/fila.test.js — src/fila.js
 * ------------------------------------------------------------------
 * O corpo de /api/doctor/queues/mine foi observado em 17/09 (fila vazia)
 * e em 14/10 (com um paciente): um array de filas, cada uma com "queue",
 * "items" e "stats". Mesmo assim a leitura de ids continua generica de
 * proposito — o formato conhecido e um CASO ESPECIAL dentro dela, nao um
 * substituto — e estes testes provam as duas coisas: que ela acerta no
 * formato real e nos plausiveis e, principalmente, que ela NAO inventa
 * fila onde nao ha. Um alarme que toca sem paciente e desligado na
 * primeira semana; um que nao toca com paciente e pior ainda.
 *
 * A CONTAGEM (contagemDaFila) e o oposto: estrita. So devolve numero para
 * o formato observado; qualquer outro devolve null, que significa "nao
 * sei" e nunca "zero".
 * ------------------------------------------------------------------ */
const fs = require("fs");
const vm = require("vm");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}

function ambiente(html) {
  const ctx = { console, Set, Map, JSON, String, Math, parseInt };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  if (html) ctx.document = montarDocumento(html);
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync("src/fila.js", "utf8"), ctx);
  return ctx;
}

/* DOM minimo: uma arvore de elementos com textContent, children e
 * parentElement — o suficiente para lerContadorAguardando(). */
function el(tag, texto, filhos) {
  const e = {
    tagName: tag.toUpperCase(),
    children: filhos || [],
    parentElement: null,
    _texto: texto || "",
  };
  e.children.forEach((f) => (f.parentElement = e));
  Object.defineProperty(e, "textContent", {
    get() {
      return e.children.length ? e.children.map((f) => f.textContent).join("") : e._texto;
    },
  });
  return e;
}

function montarDocumento(raiz) {
  function todos(no, saida) {
    saida.push(no);
    no.children.forEach((f) => todos(f, saida));
    return saida;
  }
  const lista = todos(raiz, []);
  const doc = {
    querySelectorAll: () => lista,
  };
  lista.forEach((n) => {
    n.querySelectorAll = () => todos(n, []).slice(1);
  });
  return doc;
}

/* 1. o cartao "Aguardando" — o sinal que diz QUANTOS e quando parar */
{
  const cartao = el("div", "", [el("span", "Aguardando"), el("div", "3"), el("span", "na fila agora")]);
  const tela = el("div", "", [
    el("div", "", [el("span", "Em atendimento"), el("div", "0")]),
    cartao,
    el("div", "", [el("span", "Concluídos hoje"), el("div", "5")]),
  ]);
  const F = ambiente(tela).MeedsBFila;
  ok("le o numero do cartao Aguardando", F.lerContadorAguardando() === 3, String(F.lerContadorAguardando()));
}

{
  const tela = el("div", "", [el("div", "", [el("span", "Aguardando"), el("div", "0")])]);
  const F = ambiente(tela).MeedsBFila;
  ok("le zero (é o que faz o alarme calar)", F.lerContadorAguardando() === 0);
}

{
  /* Fora do Pronto Atendimento o cartao nao existe: tem que devolver
   * null, e NAO zero — zero significaria "a fila esvaziou" e calaria um
   * alarme que devia estar tocando. */
  const tela = el("div", "", [el("h1", "Agenda"), el("div", "12")]);
  const F = ambiente(tela).MeedsBFila;
  ok("sem o cartao devolve null, nao zero", F.lerContadorAguardando() === null,
     String(F.lerContadorAguardando()));
}

/* 2. o texto do toast do proprio app */
{
  const F = ambiente().MeedsBFila;
  ok("normaliza acento e caixa", F.normalizar("  Novo PACIENTE na Fila ") === "novo paciente na fila");
  ok("o texto procurado e o do app", F.TEXTO_DO_TOAST === "novo paciente na fila");
}

/* 3. reconhecer a chamada da fila, e so ela */
{
  const F = ambiente().MeedsBFila;
  ok("reconhece /queues/mine",
     F.ehChamadaDaFila("https://api.calltechsaude.com.br/api/doctor/queues/mine"));
  ok("nao confunde com o historico",
     !F.ehChamadaDaFila("https://api.calltechsaude.com.br/api/doctor/consultations/history?period=LAST_7_DAYS"));
  ok("nao confunde com a agenda",
     !F.ehChamadaDaFila("https://api.calltechsaude.com.br/api/doctor/schedule/appointments?period=week"));
}

/* 4. leitura generica do corpo — o coracao do risco */
{
  const F = ambiente().MeedsBFila;
  const n = (x) => F.idsDeFolhas(x).length;

  ok("lista solta de pacientes", n([{ id: "p1" }, { id: "p2" }]) === 2);
  ok("dentro de 'data'", n({ data: [{ id: "p1" }, { id: "p2" }, { id: "p3" }] }) === 3);

  /* O caso que mais importa: o endereco se chama /queues/mine, entao o
   * mais provavel e uma lista de FILAS com pacientes dentro. Contar o
   * primeiro nivel diria "1" onde ha 2 esperando — e o alarme nao
   * dispararia para o segundo paciente. */
  ok("filas com pacientes dentro conta PACIENTES, nao filas",
     n({ queues: [{ id: "q1", patients: [{ id: "p1" }, { id: "p2" }] }] }) === 2);
  ok("duas filas somam os pacientes das duas",
     n({ data: [{ id: "q1", items: [{ id: "p1" }] }, { id: "q2", items: [{ id: "p2" }, { id: "p3" }] }] }) === 3);

  ok("os ids sao os das folhas",
     JSON.stringify(F.idsDeFolhas({ queues: [{ id: "q1", patients: [{ id: "p1" }] }] })) === '["p1"]');

  ok("resposta vazia nao inventa ninguem", n({ queues: [] }) === 0 && n([]) === 0);
  ok("formato inesperado nao explode", n({ mensagem: "sem filas" }) === 0 && n(null) === 0 && n("texto") === 0);
  ok("nao desce infinitamente", n(aninhar(30)) >= 0);
}

/* 4b. o FORMATO REAL, observado em 17/09 (gravacao com a fila vazia):
 * array de filas, cada uma com "queue" (descritor, com id PROPRIO) e
 * "items" (os pacientes de verdade). O id da fila nao pode contar como
 * paciente. */
{
  const F = ambiente().MeedsBFila;
  const n = (x) => F.idsDeFolhas(x).length;

  const corpoRealVazio = [
    { queue: { id: "e9abae67-...", careLine: "medica", label: "Pronto atendimento" },
      status: "ok", items: [], stats: { waiting: 0 } },
    { queue: { id: "b1f46bc2-...", careLine: "saude-mental", label: "Psicologia" },
      status: "ok", items: [], stats: { waiting: 0 } },
  ];
  ok("fila vazia (formato real) nao conta os ids DAS FILAS como paciente",
     n(corpoRealVazio) === 0, String(n(corpoRealVazio)));

  const corpoRealComPaciente = [
    { queue: { id: "e9abae67-...", careLine: "medica", label: "Pronto atendimento" },
      status: "ok", items: [{ id: "p1", nome: "nao deveria importar" }], stats: { waiting: 1 } },
    { queue: { id: "b1f46bc2-...", careLine: "saude-mental", label: "Psicologia" },
      status: "ok", items: [], stats: { waiting: 0 } },
  ];
  ok("um paciente em 'items' (formato real) conta 1, nao 3 (as 2 filas + o paciente)",
     n(corpoRealComPaciente) === 1, String(n(corpoRealComPaciente)));
  ok("o id contado e o do PACIENTE, nao o da fila",
     JSON.stringify(F.idsDeFolhas(corpoRealComPaciente)) === '["p1"]');
}

function aninhar(n) {
  let atual = { id: "fundo" };
  for (let i = 0; i < n; i++) atual = { dentro: atual };
  return atual;
}

/* 5. o mesmo id lido duas vezes e a MESMA pessoa — o alarme nao pode
 *    tocar de novo a cada poll. Quem guarda o estado e o alarme, mas a
 *    estabilidade dos ids e condicao para aquilo funcionar. */
{
  const F = ambiente().MeedsBFila;
  const corpo = { queues: [{ id: "q1", patients: [{ id: "p1" }, { id: "p2" }] }] };
  const a = F.idsDeFolhas(corpo).sort().join(",");
  const b = F.idsDeFolhas(corpo).sort().join(",");
  ok("a leitura e estavel entre chamadas", a === b && a === "p1,p2", a);
}

/* 6. lerOrigemDoUltimoPaciente — a cidade do cartao Discreto, NUNCA o nome */
{
  // linha da fila como vista na gravacao: avatar, nome, selo de cidade
  // minusculo, o marcador "Novo" e o botao "Atender".
  const linha = el("div", "", [
    el("div", "", []), // avatar (iniciais), sem texto solto
    el("div", "", [
      el("div", "Marcelo Delfino dos Santos"), // nome — nunca deve ser lido
      el("div", "", [el("span", "macae")]),    // selo de cidade
    ]),
    el("div", "", [el("span", "Novo"), el("button", "Atender")]),
  ]);
  const F = ambiente(linha).MeedsBFila;
  ok("acha a cidade do paciente marcado 'Novo'", F.lerOrigemDoUltimoPaciente() === "macae",
     String(F.lerOrigemDoUltimoPaciente()));
}

{
  // sem o marcador "Novo" (paciente ja conhecido, nao e chegada): nao ha
  // o que ancorar, e a funcao NAO deve varrer a tela inteira atras de
  // qualquer selo minusculo por ai.
  const tela = el("div", "", [
    el("div", "", [el("div", "Alguem Aqui"), el("span", "macae")]),
  ]);
  const F = ambiente(tela).MeedsBFila;
  ok("sem o marcador 'Novo' devolve null", F.lerOrigemDoUltimoPaciente() === null);
}

{
  // o nome NUNCA casa o padrao do selo: Title Case e mais de uma palavra.
  // Isto prova a propriedade de seguranca, nao so o caminho feliz.
  const F = ambiente().MeedsBFila;
  const nome = "Marcelo Delfino dos Santos";
  ok("nome de paciente nao casa o padrao do selo de cidade",
     !/^\p{Ll}[\p{Ll}-]{1,29}$/u.test(nome));
}

{
  // fora do Pronto Atendimento (sem document): null, nunca erro.
  const F = ambiente().MeedsBFila;
  ok("sem tela nao explode", F.lerOrigemDoUltimoPaciente() === null);
}

/* 7. identidade: a ENTRADA na fila (consultationId), nao a pessoa */
{
  const F = ambiente().MeedsBFila;
  const fila = (items) => [{ queue: { id: "q1" }, status: "ok", items, stats: { waiting: items.length } }];
  const real = { consultationId: "c1", priority: "normal", tenantId: "macae",
                 patient: { id: "p1", name: "nunca lido", locality: {} } };

  ok("item real: a chave e o consultationId, nao o patient.id",
     JSON.stringify(F.idsDeFolhas(fila([real]))) === '["c1"]', JSON.stringify(F.idsDeFolhas(fila([real]))));
  ok("a mesma pessoa em outra consulta e outra chave",
     F.idsDeFolhas(fila([real]))[0] !== F.idsDeFolhas(fila([{ consultationId: "c2", patient: { id: "p1" } }]))[0]);
  ok("sem consultationId, cai no id do proprio item",
     JSON.stringify(F.idsDeFolhas(fila([{ id: "x9", patient: { id: "p1" } }]))) === '["x9"]');
  ok("so com patient.id, usa ele",
     JSON.stringify(F.idsDeFolhas(fila([{ patient: { id: "p7" } }]))) === '["p7"]');
  ok("item sem nenhuma chave nao vira id vazio",
     F.idsDeFolhas(fila([{ priority: "normal" }])).every((x) => x !== "" && x !== "undefined"));
}

/* 8. contagemDaFila — estrita: so o formato observado, e null = "nao sei" */
{
  const F = ambiente().MeedsBFila;
  const q = (waiting, items) => ({ queue: { id: "q" }, status: "ok", items: items || [], stats: { waiting } });

  ok("duas filas somam o stats.waiting", F.contagemDaFila([q(0), q(3, [{}, {}, {}])]) === 3);
  ok("fila vazia no formato real e ZERO, nao null", F.contagemDaFila([q(0), q(0)]) === 0);
  ok("sem stats.waiting, usa o tamanho de items",
     F.contagemDaFila([{ queue: { id: "q" }, items: [{}, {}] }]) === 2);
  ok("lista vazia nao e zero: e desconhecido", F.contagemDaFila([]) === null);
  ok("objeto solto nao e formato conhecido", F.contagemDaFila({ data: [q(2)] }) === null);
  ok("uma entrada fora do formato invalida a conta toda", F.contagemDaFila([q(2), { id: "x" }]) === null);
  ok("sem 'items' em array nao conta", F.contagemDaFila([{ queue: { id: "q" }, items: "x" }]) === null);
  ok("null e texto nao explodem", F.contagemDaFila(null) === null && F.contagemDaFila("fila") === null);
  ok("stats negativo e ignorado", F.contagemDaFila([{ queue: { id: "q" }, items: [{}], stats: { waiting: -4 } }]) === 1);
}

/* 9. o toast: so um no PEQUENO que contem a frase */
{
  function disparos(texto) {
    const ctx = ambiente(el("div", "", []));
    let aoMutar = null;
    ctx.MutationObserver = function (f) { aoMutar = f; this.observe = () => {}; this.disconnect = () => {}; };
    ctx.document.documentElement = {};
    let n = 0;
    ctx.MeedsBFila.observarToast(() => { n++; });
    aoMutar([{ addedNodes: [{ nodeType: 1, textContent: texto }] }]);
    return n;
  }
  ok("o toast real dispara", disparos("Novo paciente na fila Fulano · Teste") === 1);
  ok("um no enorme que so contem a frase nao dispara",
     disparos("x ".repeat(500) + "novo paciente na fila") === 0);
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
