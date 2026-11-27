/* tests/atualizacao.test.js — a verificacao de versao nova (src/atualizacao.js e o clique no sino) */
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { ligar } = require("./helpers/ambiente-alarme");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs !== undefined ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}
function cenario(nome, fn) {
  console.log("\n" + nome);
  try { fn(); } catch (e) { ok("o cenario terminou sem excecao", false, e && e.stack); }
}

const RAW = "https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/";
const meta = (v) => ({ status: 200, texto: "// ==UserScript==\n// @name  X\n// @version      " + v + "\n// ==/UserScript==\n" });

/* ---------- unitario: src/atualizacao.js num vm com fetch falso ---------- */
function unidade(resposta) {
  const chamadas = [];
  const timers = [];
  const ctx = {
    Date: { now: () => 1 },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; },
    clearTimeout() {},
    AbortController,
    fetch(url, opcoes) {
      chamadas.push({ url, opcoes });
      if (resposta === "pendurar") return new Promise(() => {});
      if (resposta === "erro") return Promise.reject(new Error("rede"));
      return Promise.resolve({ status: resposta.status, ok: resposta.status < 300, text: () => Promise.resolve(resposta.texto) });
    },
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, "..", "src/atualizacao.js"), "utf8"), ctx);
  return { U: ctx.MeedsBAtualizacao, chamadas, timers };
}
const verificar = (u, atual, variante) =>
  new Promise((res) => u.U.verificar(atual, variante, res));
const tick = () => new Promise((r) => setImmediate(r));

(async () => {
  console.log("\nextrairVersao e compararVersoes");
  const { U } = unidade("erro");
  ok("le o @version", U.extrairVersao("// @version      1.6.1") === "1.6.1");
  ok("sem @version -> null", U.extrairVersao("nada aqui") === null);
  ok("1.6.10 > 1.6.9", U.compararVersoes("1.6.10", "1.6.9") === 1);
  ok("1.6.0 = 1.6.0", U.compararVersoes("1.6.0", "1.6.0") === 0);
  ok("1.5.9 < 1.6.0", U.compararVersoes("1.5.9", "1.6.0") === -1);

  console.log("\nverificar");
  let u = unidade(meta("1.7.0"));
  let r = await verificar(u, "1.6.0", "tampermonkey");
  ok("versao nova", r.nova === true && r.versao === "1.7.0", JSON.stringify(r));
  ok("instalar sem query", r.instalar === RAW + "meeds-b.user.js", r.instalar);
  ok("consulta o meta certo com ?t=", u.chamadas[0].url.indexOf(RAW + "meeds-b.meta.js?t=") === 0, u.chamadas[0].url);
  ok("credentials omit", u.chamadas[0].opcoes.credentials === "omit");
  u = unidade(meta("1.7.0"));
  r = await verificar(u, "1.6.0", "safari");
  ok("safari: meta e instalar proprios",
    u.chamadas[0].url.indexOf(RAW + "meeds-b.safari.meta.js?t=") === 0 && r.instalar === RAW + "meeds-b.safari.user.js");
  r = await verificar(unidade(meta("1.6.0")), "1.6.0", "tampermonkey");
  ok("igual -> nova false", r.nova === false);
  r = await verificar(unidade(meta("1.5.0")), "1.6.0", "tampermonkey");
  ok("menor -> nova false", r.nova === false);
  r = await verificar(unidade("erro"), "1.6.0", "tampermonkey");
  ok("erro de rede -> nova false", r.nova === false);
  r = await verificar(unidade({ status: 404, texto: "x" }), "1.6.0", "tampermonkey");
  ok("HTTP 404 -> nova false", r.nova === false);
  r = await verificar(unidade({ status: 200, texto: "sem versao" }), "1.6.0", "tampermonkey");
  ok("sem versao -> nova false", r.nova === false);
  u = unidade("pendurar");
  const p = verificar(u, "1.6.0", "tampermonkey");
  await tick();
  ok("prazo de 10 s agendado", u.timers.length === 1 && u.timers[0].ms === 10000);
  u.timers[0].fn();
  r = await p;
  ok("prazo estourado -> nova false", r.nova === false);

  /* ---------- no alarme: o clique no sino ---------- */
  cenario("clique no sino com versao mais nova", () => {
    const A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.7.0"));
    A.clicar("mb-botao");
    ok("cartao visivel", A.ui("mb-atualizacao").hidden === false);
    const html = A.ui("mb-atualizacao").innerHTML;
    ok("diz as duas versoes", html.indexOf("A versão 1.7.0 está disponível (você usa a 1.6.0).") >= 0);
    ok("titulo", html.indexOf("Nova versão do alarme") >= 0);
    ok("sem @grant extra: variante tampermonkey", A.chamadasDeMeta[0].url.indexOf("meeds-b.meta.js") >= 0);
    ok("nao tocou na fila de respostas da consulta", A.chamadasDeFetch.length === 0);
    A.clicar("mb-atualizar");
    ok("Atualizar agora abre o .user.js", A.janelasAbertas().indexOf(RAW + "meeds-b.user.js") >= 0);
    ok("e fecha o cartao", A.ui("mb-atualizacao").hidden === true);
  });

  cenario("Depois, Esc e meta igual", () => {
    let A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.7.0"));
    A.clicar("mb-botao");
    A.clicar("mb-atualizacao-depois");
    ok("Depois esconde", A.ui("mb-atualizacao").hidden === true);
    A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.7.0"));
    A.clicar("mb-botao");
    A.teclar("mb-atualizacao", "Escape");
    ok("Esc esconde", A.ui("mb-atualizacao").hidden === true);
    A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.6.0"));
    A.clicar("mb-botao");
    ok("meta igual: cartao escondido", A.ui("mb-atualizacao").hidden === true);
  });

  cenario("no maximo uma vez a cada 30 min", () => {
    const A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.6.0"), meta("1.6.0"));
    A.clicar("mb-botao");
    A.clicar("mb-botao");
    ok("dois cliques -> 1 fetch", A.chamadasDeMeta.length === 1, A.chamadasDeMeta.length);
    A.avancar(29 * 60000);
    A.clicar("mb-botao");
    ok("aos 29 min ainda 1", A.chamadasDeMeta.length === 1);
    A.avancar(60000);
    A.clicar("mb-botao");
    ok("aos 30 min outro fetch", A.chamadasDeMeta.length === 2, A.chamadasDeMeta.length);
  });

  cenario("o sino continua ciclando a intensidade", () => {
    const A = ligar({ guardado: {} });
    A.respostasDeMeta.push(meta("1.7.0"));
    const antes = A.config().intensidade;
    A.clicar("mb-botao");
    ok("intensidade mudou", A.config().intensidade !== antes, antes + " -> " + A.config().intensidade);
  });

  console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
  process.exit(falhas ? 1 : 0);
})();
