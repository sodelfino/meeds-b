/* ------------------------------------------------------------------
 * tests/alarme-sinais.test.js — de onde o alarme tira o que sabe
 * ------------------------------------------------------------------
 * O alarme decide com tres fontes imperfeitas: o toast do app, o
 * contador do DOM e a resposta de /queues/mine. Aqui ficam os cenarios
 * sobre a QUALIDADE dessas fontes — quem e "o mesmo paciente", o que
 * conta como um toast, como a rede e lida — e a fronteira de
 * privacidade, que atravessa as tres.
 * ------------------------------------------------------------------ */
const { ligar, telaFila, filaReal, el } = require("./helpers/ambiente-alarme");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs !== undefined ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}
function cenario(nome, fn) {
  console.log("\n" + nome);
  try {
    fn();
  } catch (e) {
    ok("o cenario terminou sem excecao", false, e && e.message);
  }
}

const SEG = 1000;
const MIN = 60 * SEG;

/* uma linha de paciente com os chips que o teste quiser, na ordem dada */
function linha(nome, chips, novo) {
  return el("div", "", [
    el("div", "", []),
    el("div", "", [el("div", nome), el("div", "", chips.map((c) => el("span", c)))]),
    el("div", "", [novo === false ? el("span", "2 min") : el("span", "Novo"), el("button", "Atender")]),
  ]);
}
function telaComLinhas(aguardando, linhas) {
  const cartao = el("div", "", [el("span", "Aguardando"), el("div", String(aguardando)), el("span", "na fila agora")]);
  return el("div", "", [cartao].concat(linhas));
}

/* ---------------- identidade do paciente ---------------- */

cenario("I1: o mesmo paciente com CONSULTA nova, sem resposta vazia no meio, e uma chegada", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responder(filaReal([]));
  A.responder(filaReal([{ c: "c1", p: "p1" }]));
  A.avancar(20 * SEG);
  ok("a primeira consulta toca", A.sons.length === 2, String(A.sons.length));
  A.responder(filaReal([{ c: "c2", p: "p1" }]));
  A.avancar(3 * SEG);
  ok("a consulta nova do mesmo paciente toca de novo", A.sons.length === 4, String(A.sons.length));
});

cenario("I1b: item so com consultationId (sem patient.id) tambem e reconhecido", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responder(filaReal([]));
  A.responder(filaReal([{ c: "c9" }]));
  A.avancar(3 * SEG);
  ok("tocou", A.sons.length === 2, String(A.sons.length));
});

cenario("a mesma resposta lida de novo NAO e chegada", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responder(filaReal([]));
  A.responder(filaReal([{ c: "c1", p: "p1" }]));
  A.avancar(30 * SEG);
  A.responder(filaReal([{ c: "c1", p: "p1" }]));
  ok("so as 2 batidas da primeira", A.sons.length === 2, String(A.sons.length));
});

cenario("saiu um e entrou outro entre duas respostas: e chegada", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responder(filaReal([]));
  A.responder(filaReal([{ c: "c1", p: "p1" }]));
  A.avancar(30 * SEG);
  A.responder(filaReal([{ c: "c2", p: "p2" }]));
  A.avancar(3 * SEG);
  ok("tocou pelo novo", A.sons.length === 4, String(A.sons.length));
});

/* ---------------- a rede e a contagem ---------------- */

cenario("a contagem da rede vale quando o contador nao esta na tela", () => {
  const A = ligar({ intensidade: "completo" });
  A.responder(filaReal([{ c: "c1", p: "p1" }, { c: "c2", p: "p2" }]));
  ok("2", A.estado().aguardando === 2, String(A.estado().aguardando));
});

cenario("formato desconhecido NAO inventa contagem", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(3, [{ nome: "A B", cidade: "macae" }]) });
  A.responder({ qualquer: "coisa", lista: [{ id: "x" }] });
  ok("continua com o que o DOM leu", A.estado().aguardando === 3, String(A.estado().aguardando));
});

/* ---------------- XHR ---------------- */

cenario("XHR com responseType 'json' (responseText lanca) ainda e lido", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responderXHR(filaReal([]), "json");
  A.responderXHR(filaReal([{ c: "c1", p: "p1" }]), "json");
  A.avancar(3 * SEG);
  ok("tocou", A.sons.length === 2, String(A.sons.length));
});

cenario("XHR de texto continua funcionando", () => {
  const A = ligar({ intensidade: "discreto" });
  A.responderXHR(filaReal([]), "texto");
  A.responderXHR(filaReal([{ c: "c1", p: "p1" }]), "texto");
  A.avancar(3 * SEG);
  ok("tocou", A.sons.length === 2, String(A.sons.length));
});

/* ---------------- o toast ---------------- */

cenario("I6: um no enorme que apenas CONTEM a frase nao e o toast", () => {
  const A = ligar({ intensidade: "discreto" });
  A.toast("x ".repeat(600) + " novo paciente na fila");
  A.avancar(3 * SEG);
  ok("nao tocou", A.sons.length === 0, String(A.sons.length));
});

cenario("o toast real (frase + nome + fila) toca", () => {
  const A = ligar({ intensidade: "discreto" });
  A.toast("Novo paciente na fila Fulano de Tal · Teste");
  A.avancar(3 * SEG);
  ok("tocou", A.sons.length === 2, String(A.sons.length));
});

/* ---------------- a cidade do cartao ---------------- */

cenario("cidade: um selo limpo aparece", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaComLinhas(1, [linha("Fulano de Tal", ["macae"])]));
  A.toast();
  ok("mostra macae", A.cartao().linhas.indexOf("macae") !== -1, JSON.stringify(A.cartao().linhas));
});

cenario("I5: nome em minusculas de uma palavra so, ao lado do selo, NAO vira cidade", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaComLinhas(1, [linha("maria", ["macae"])]));
  A.toast();
  const l = A.cartao().linhas;
  ok("o nome nao aparece", l.indexOf("maria") === -1, JSON.stringify(l));
});

cenario("I5b: chip de prioridade antes do selo e ambiguo — nao adivinha", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaComLinhas(1, [linha("Fulano de Tal", ["normal", "macae"])]));
  A.toast();
  const l = A.cartao().linhas;
  ok("nao mostra 'normal' como se fosse cidade", l.indexOf("normal") === -1, JSON.stringify(l));
});

cenario("I5c: duas linhas 'Novo' de cidades diferentes — nao adivinha a mais recente", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaComLinhas(2, [linha("Ana Souza", ["campos"]), linha("Beto Lima", ["macae"])]));
  A.toast();
  const l = A.cartao().linhas;
  ok("nao escolhe nenhuma", l.indexOf("campos") === -1 && l.indexOf("macae") === -1, JSON.stringify(l));
});

cenario("duas linhas 'Novo' da MESMA cidade: nao ha duvida, mostra", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaComLinhas(2, [linha("Ana Souza", ["macae"]), linha("Beto Lima", ["macae"])]));
  A.toast();
  ok("mostra macae", A.cartao().linhas.indexOf("macae") !== -1, JSON.stringify(A.cartao().linhas));
});

/* ---------------- privacidade (norma 2) ---------------- */

cenario("o nome do paciente nao aparece em NENHUM lugar que o medico, ou uma tela compartilhada, veja", () => {
  const A = ligar({ intensidade: "discreto" });
  A.foraDaAba(true);
  A.responder(filaReal([]));
  A.mostrarTela(telaFila(1, [{ nome: "Fulano de Tal", cidade: "macae", novo: true }]));
  A.toast("Novo paciente na fila Fulano de Tal · Teste");
  A.responder(filaReal([{ c: "c1", p: "p1" }])); // o payload traz patient.name
  A.avancar(10 * MIN);
  const tudo = A.textosVisiveis().join("\n").toLowerCase();
  ok("sem o nome que estava na tela", tudo.indexOf("fulano") === -1);
  ok("sem o nome que estava no payload", tudo.indexOf("nome que nunca") === -1);
  ok("ha texto para ler (o teste nao esta vazio)", tudo.length > 20, String(tudo.length));
});

cenario("nada do paciente vai para o disco: so a preferencia do medico", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, [{ nome: "Fulano de Tal", cidade: "macae", novo: true }]));
  A.toast("Novo paciente na fila Fulano de Tal · Teste");
  A.responder(filaReal([{ c: "consulta-secreta", p: "paciente-secreto" }]));
  A.mudarIntensidade("completo"); // forca uma gravacao da configuracao
  const disco = A.armazenado().toLowerCase();
  ok("a preferencia foi gravada (o teste enxerga o disco)", disco.indexOf("intensidade") !== -1, disco);
  ok("sem o nome", disco.indexOf("fulano") === -1 && disco.indexOf("nome que nunca") === -1);
  ok("sem id de paciente nem de consulta", disco.indexOf("paciente-secreto") === -1 && disco.indexOf("consulta-secreta") === -1);
  ok("sem a cidade lida para o cartao", disco.indexOf("macae") === -1);
});

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
