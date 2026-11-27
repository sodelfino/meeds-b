/* ------------------------------------------------------------------
 * tests/alarme-consulta.test.js — a consulta propria da fila (src/alarme.js)
 * ------------------------------------------------------------------
 * Fora do Pronto Atendimento o contador "Aguardando" nao existe, e a tela
 * so busca a fila quando o medico clica no menu. Sem uma leitura fresca o
 * lembrete nao pode soar (D64). Por isso o alarme faz, a cada 15 s, um GET
 * so de leitura em /api/doctor/queues/mine, com o cabecalho que a propria
 * tela usou — guardado so em memoria, nunca em disco.
 * ------------------------------------------------------------------ */
const { ligar, telaFila, telaSemContador, filaReal } = require("./helpers/ambiente-alarme");

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
const PAC = [{ nome: "Fulano de Tal", cidade: "macae", novo: true }];
/* ligar() deixa o relogio em 4,1 s; a primeira consulta sai aos 15 s */
const ATE_A_PRIMEIRA = 15000 - 4100;

cenario("faz GET sozinho apos 15 s", () => {
  const A = ligar({ intensidade: "completo" });
  A.avancar(ATE_A_PRIMEIRA - 1);
  ok("nada antes dos 15 s", A.chamadasDeFetch.length === 0, String(A.chamadasDeFetch.length));
  A.avancar(1);
  ok("uma chamada", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  const c = A.chamadasDeFetch[0] || { opcoes: {} };
  ok("na fila do medico", /\/api\/doctor\/queues\/mine$/.test(c.url), c.url);
  ok("com credenciais", c.opcoes.credentials === "include", c.opcoes.credentials);
  ok("so GET", !c.opcoes.method || c.opcoes.method === "GET", c.opcoes.method);
});

cenario("reusa cabecalho do app, so em memoria", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer T" } });
  A.avancar(ATE_A_PRIMEIRA);
  const c = A.chamadasDeFetch[0] || { opcoes: {} };
  ok("manda o mesmo Authorization", (c.opcoes.headers || {}).Authorization === "Bearer T", JSON.stringify(c.opcoes.headers));
  ok("no mesmo endereco que a tela usou", c.url === "https://api.calltechsaude.com.br/api/doctor/queues/mine", c.url);
  ok("nada do token em disco", !/Bearer/.test(JSON.stringify(A.disco()) + A.armazenado()));
});

cenario("401 suspende e a tela retoma", () => {
  const A = ligar({ intensidade: "completo" });
  A.respostasDeFetch.push({ status: 401 });
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(60 * SEG);
  ok("so 1 chamada enquanto suspensa", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer novo" } });
  A.avancar(15 * SEG);
  ok("a tela buscou de novo: a consulta volta", A.chamadasDeFetch.length === 2, String(A.chamadasDeFetch.length));
});

cenario("erro 500 espera 60 s", () => {
  const A = ligar({ intensidade: "completo" });
  A.respostasDeFetch.push({ status: 500 });
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(59 * SEG);
  ok("nenhuma chamada nova em 59 s", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  A.avancar(1 * SEG);
  ok("uma aos 60 s", A.chamadasDeFetch.length === 2, String(A.chamadasDeFetch.length));
});

cenario("sem sobreposicao", () => {
  const A = ligar({ intensidade: "completo" });
  A.respostasDeFetch.push("pendurar");
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(60 * SEG);
  ok("so 1 chamada enquanto a primeira nao responde", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
});

cenario("fila vazia pela consulta cala o alarme", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  ok("tocando", A.estado().tocando === true);
  A.mostrarTela(telaSemContador("Consulta"));
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("calou", !A.estado().tocando);
  const antes = A.sons.length;
  A.avancar(120 * SEG);
  ok("nenhum lembrete depois", A.sons.length === antes, A.sons.length - antes + " toques");
});

cenario("atender e eco atrasado da consulta", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.appBuscaFila(filaReal([]));
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.clicarNaPagina(A.botao("Atender"));
  A.mostrarTela(telaSemContador("Consulta"));
  const antes = A.sons.length;
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([{ c: "c1", p: "p1" }]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("a consulta trouxe o eco", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  A.avancar(15 * SEG);
  ok("o eco nao toca de novo", A.sons.length === antes, A.sons.length - antes + " toques");
});

cenario("a consulta propria nao passa pelo gancho", () => {
  const A = ligar({ intensidade: "completo" });
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("a consulta respondeu", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  ok("o gancho da tela nao a viu", A.estado().respostasDaTela === 0, String(A.estado().respostasDaTela));
  A.appBuscaFila(filaReal([]));
  ok("mas ve a busca da tela", A.estado().respostasDaTela === 1, String(A.estado().respostasDaTela));
});

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
