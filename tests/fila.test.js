/* ------------------------------------------------------------------
 * tests/fila.test.js — src/fila.js
 * ------------------------------------------------------------------
 * O corpo de /api/doctor/queues/mine NUNCA foi observado: as gravacoes
 * guardam corpo so de requisicao com erro, e essa sempre respondeu 200.
 * Todo o desenho da leitura de rede parte disso — ela e generica de
 * proposito, e estes testes existem para provar que ela acerta nos
 * formatos plausiveis e, principalmente, que ela NAO inventa fila onde
 * nao ha. Um alarme que toca sem paciente e desligado na primeira
 * semana; um que nao toca com paciente e pior ainda.
 *
 * Se um dia o formato real aparecer, acrescente-o aqui como mais um
 * caso — nao troque a leitura generica por ele.
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

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
