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
/* a primeira consulta sai 15 s depois da primeira busca da fila pela tela */
const ATE_A_PRIMEIRA = 15000;

cenario("sem chamada do app nao consulta", () => {
  const A = ligar({ intensidade: "completo" });
  A.avancar(60 * SEG);
  ok("nenhum fetch as cegas", A.chamadasDeFetch.length === 0, String(A.chamadasDeFetch.length));
});

cenario("faz GET sozinho apos 15 s", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]), { withCredentials: true });
  A.avancar(ATE_A_PRIMEIRA - 1);
  ok("nada antes dos 15 s", A.chamadasDeFetch.length === 0, String(A.chamadasDeFetch.length));
  A.avancar(1);
  ok("uma chamada", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  const c = A.chamadasDeFetch[0] || { opcoes: {} };
  ok("na fila do medico", /\/api\/doctor\/queues\/mine$/.test(c.url), c.url);
  ok("credenciais como a tela (withCredentials -> include)", c.opcoes.credentials === "include", c.opcoes.credentials);
  ok("so GET", !c.opcoes.method || c.opcoes.method === "GET", c.opcoes.method);
});

cenario("tela sem withCredentials -> same-origin", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]));
  A.avancar(ATE_A_PRIMEIRA);
  const c = A.chamadasDeFetch[0] || { opcoes: {} };
  ok("same-origin", c.opcoes.credentials === "same-origin", c.opcoes.credentials);
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
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push({ status: 401 });
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(60 * SEG);
  ok("so 1 chamada enquanto suspensa", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer novo" } });
  A.avancar(15 * SEG);
  ok("a tela buscou de novo: a consulta volta", A.chamadasDeFetch.length === 2, String(A.chamadasDeFetch.length));
});

cenario("erro 500 espera 30 s", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push({ status: 500 });
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(29 * SEG);
  ok("nenhuma chamada nova em 29 s", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  A.avancar(1 * SEG);
  ok("uma aos 30 s", A.chamadasDeFetch.length === 2, String(A.chamadasDeFetch.length));
});

cenario("sem sobreposicao", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push("pendurar");
  A.avancar(ATE_A_PRIMEIRA);
  A.avancar(9 * SEG);
  ok("so 1 chamada enquanto a primeira nao responde", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
});

/* I1: rede presa (Wi-Fi trocando, notebook acordando) nao pode matar a consulta pelo resto do plantao */
cenario("consulta pendurada e abortada aos 10 s e volta depois do recuo", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push("pendurar");
  A.avancar(ATE_A_PRIMEIRA);
  const c = A.chamadasDeFetch[0] || { opcoes: {} };
  ok("a consulta leva um sinal de abortar", !!c.opcoes.signal);
  A.avancar(10 * SEG);
  ok("abortada aos 10 s", !!(c.opcoes.signal && c.opcoes.signal.aborted));
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(30 * SEG);
  ok("tenta de novo 30 s depois do aborto", A.chamadasDeFetch.length === 2, String(A.chamadasDeFetch.length));
  A.avancar(4 * 60 * 60 * SEG);
  ok("continua consultando horas depois", A.chamadasDeFetch.length > 100, String(A.chamadasDeFetch.length));
});

/* I2: uma chamada da fila sem cabecalho nao apaga o token capturado */
cenario("chamada do app sem Authorization nao apaga o token", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer T" } });
  A.appBuscaFila(filaReal([]));
  A.appBuscaFila(filaReal([]), { headers: { "X-Outro": "1" } });
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  const h = (A.chamadasDeFetch[0] || { opcoes: {} }).opcoes.headers || {};
  ok("mantem o Authorization", h.Authorization === "Bearer T", JSON.stringify(h));
  A.appBuscaFila(filaReal([]), { headers: { authorization: "Bearer novo" } });
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(15 * SEG);
  const h2 = (A.chamadasDeFetch[1] || { opcoes: {} }).opcoes.headers || {};
  ok("troca quando vem um token novo (nome em minusculas)", h2.authorization === "Bearer novo", JSON.stringify(h2));
});

cenario("fila vazia pela consulta cala o alarme", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.appBuscaFila(filaReal([]));
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
  A.appBuscaFila(filaReal([]));
  ok("o gancho ve a busca da tela", A.estado().respostasDaTela === 1, String(A.estado().respostasDaTela));
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("a consulta respondeu", A.chamadasDeFetch.length === 1, String(A.chamadasDeFetch.length));
  ok("o gancho nao viu a consulta", A.estado().respostasDaTela === 1, String(A.estado().respostasDaTela));
});

/* Avanca em passos de 15 s e responde a cada consulta com corpo() */
function avancarConsultando(A, ms, corpo) {
  for (let t = 0; t < ms; t += 15 * SEG) {
    A.respostasDeFetch.push({ status: 200, corpo: corpo() });
    A.avancar(15 * SEG);
  }
}
const UM = () => filaReal([{ c: "c1" }]);
/* Discreto fora do PA, 1 paciente ja na fila quando a consulta comeca */
function discretoForaDoPA() {
  const A = ligar({ intensidade: "discreto", tela: telaSemContador() });
  A.appBuscaFila(filaReal([]));
  avancarConsultando(A, 15 * SEG, () => filaReal([]));
  avancarConsultando(A, 15 * SEG, UM); // chegada: som duplo
  A.avancar(4 * SEG);                  // a segunda batida
  return A;
}

cenario("discreto lembra a cada 1 min fora do PA", () => {
  const A = discretoForaDoPA();
  const base = A.sons.length;
  ok("a chegada tocou", base === 2, String(base));
  avancarConsultando(A, 60 * SEG, UM);
  ok("+1 som aos 60 s", A.sons.length === base + 2, String(A.sons.length - base));
  avancarConsultando(A, 60 * SEG, UM);
  ok("+1 som aos 120 s", A.sons.length === base + 4, String(A.sons.length - base));
});

cenario("aviso traz a espera do mais antigo", () => {
  const A = discretoForaDoPA();
  avancarConsultando(A, 4 * 60 * SEG, UM);
  const txt = A.cartao().titulo + " | " + A.motivoDoBanner() + " | " + A.cartao().linhas.join(" | ");
  ok("diz o mais antigo ha 4 min", /o mais antigo há 4 min/.test(txt), txt);
});

cenario("waitingSince de 7 min atras ja aparece como 7 min", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador() });
  A.appBuscaFila(filaReal([]));
  const em = new Date(A.agora() - 7 * 60 * SEG).toISOString();
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([{ c: "c1", em }]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("7 min", /o mais antigo há 7 min/.test(A.motivoDoBanner()), A.motivoDoBanner());
});

cenario("so checkedInAt (reserva) de 7 min atras tambem aparece como 7 min", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador() });
  A.appBuscaFila(filaReal([]));
  const ci = new Date(A.agora() - 7 * 60 * SEG).toISOString();
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([{ c: "c1", ci }]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("7 min", /o mais antigo há 7 min/.test(A.motivoDoBanner()), A.motivoDoBanner());
});

cenario("degrau aos 5 min no discreto", () => {
  const A = discretoForaDoPA();
  avancarConsultando(A, 4 * 60 * SEG, UM);
  ok("antes do degrau sem faixa", !A.bannerVisivel());
  avancarConsultando(A, 60 * SEG, UM);
  ok("aos 5 min a faixa aparece", A.bannerVisivel());
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  ok("fila vazia apaga a faixa", !A.bannerVisivel());
});

cenario("formato desconhecido nao toca nem desiste", () => {
  const A = discretoForaDoPA();
  const base = A.sons.length;
  avancarConsultando(A, 180 * SEG, () => ({ outra: "coisa" }));
  ok("nenhum som", A.sons.length === base, String(A.sons.length - base));
  avancarConsultando(A, 60 * SEG, UM);
  ok("voltando ao formato real, soa no proximo minuto", A.sons.length > base, String(A.sons.length - base));
});

cenario("silencioso continua mudo", () => {
  const A = ligar({ intensidade: "silencioso", tela: telaSemContador() });
  A.appBuscaFila(filaReal([]));
  avancarConsultando(A, 15 * SEG, () => filaReal([]));
  avancarConsultando(A, 300 * SEG, UM);
  ok("nenhum som", A.sons.length === 0, String(A.sons.length));
});

/* tela da fila com [p1, p2] e depois [p2] pela consulta */
function pacienteSaiu(telaFinal) {
  const t0 = telaFila(2, PAC);
  const A = ligar({ intensidade: "completo", tela: t0 });
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([{ c: "p1" }, { c: "p2" }]) });
  A.avancar(ATE_A_PRIMEIRA);
  A.mostrarTela(telaFinal || t0);
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([{ c: "p2" }]) });
  A.avancar(ATE_A_PRIMEIRA);
  return A;
}

cenario("paciente saiu, na tela da fila: barra aparece", () => {
  const A = pacienteSaiu();
  ok("barra visivel", !A.stub("mb-fila-mudou").hidden);
  ok("texto", A.stub("mb-fila-mudou-texto").textContent === "A fila mudou — outro médico pode ter atendido.");
});

cenario("na agenda a barra nao aparece", () => {
  const A = pacienteSaiu(telaSemContador());
  ok("barra escondida", A.stub("mb-fila-mudou").hidden);
});

cenario("clicar atualiza pelo menu", () => {
  const t = telaFila(2, PAC);
  const A = pacienteSaiu(t);
  A.clicar("mb-atualizar-fila");
  ok("menu clicado", t.menu.cliques === 1, String(t.menu.cliques));
  ok("barra escondida", A.stub("mb-fila-mudou").hidden);
});

cenario("resposta da tela esconde a barra", () => {
  const A = pacienteSaiu();
  A.appBuscaFila(filaReal([{ c: "p2" }]));
  ok("barra escondida", A.stub("mb-fila-mudou").hidden);
});

cenario("a barra nao cobre o banner do alarme", () => {
  /* o stub nao expressa layout: confere a regra de CSS (barra embaixo, banner no topo) */
  const css = require("fs").readFileSync(require("path").join(__dirname, "..", "src", "alarme.js"), "utf8");
  const regra = (id) => { const i = css.indexOf('"' + id + ' {",'); return i < 0 ? "" : css.slice(i, css.indexOf('"}",', i)).replace(/^\s*\/\*.*\*\/\s*$/gm, ""); };
  ok("banner no topo", /top: 0/.test(regra("#mb-banner")));
  ok("barra embaixo, sem top", /bottom: 20px/.test(regra("#mb-fila-mudou")) && !/top:/.test(regra("#mb-fila-mudou")));
});

/* contador 3 na tela, base conhecida, depois claim */
function comTresNaTela() {
  const A = ligar({ intensidade: "completo", tela: telaFila(3, PAC) });
  A.appBuscaFila(filaReal([{ c: "a" }, { c: "b" }, { c: "c" }]));
  return A;
}

cenario("claim 201 tira um da conta", () => {
  const A = comTresNaTela();
  A.claim("a", 201);
  ok("sobraram 2", A.estado().aguardando === 2, String(A.estado().aguardando));
});

cenario("claim 409 mostra aviso de outro medico", () => {
  const A = comTresNaTela();
  A.claim("a", 409);
  ok("barra visivel", !A.stub("mb-fila-mudou").hidden);
  ok("texto", A.stub("mb-fila-mudou-texto").textContent === "Outro médico já atendeu este paciente.");
  ok("nao descontou", A.estado().aguardando === 3, String(A.estado().aguardando));
});

cenario("clique + claim nao descontam dois", () => {
  const A = comTresNaTela();
  A.clicarNaPagina(A.botao("Atender"));
  A.claim("a", 201);
  A.claim("a", 201);
  ok("so um desconto", A.estado().aguardando === 2, String(A.estado().aguardando));
  const B = comTresNaTela();
  B.claim("a", 201);
  B.clicarNaPagina(B.botao("Atender"));
  ok("claim e depois clique: um so", B.estado().aguardando === 2, String(B.estado().aguardando));
});

/* ---------- revisao final: C1, C2, I3, I4 ---------- */

/* C1: contador da tela parado em 1, consulta dizendo fila vazia */
function contadorParadoComFilaVazia() {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.appBuscaFila(filaReal([]));
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(4 * SEG);
  A.respostasDeFetch.push({ status: 200, corpo: filaReal([]) });
  A.avancar(ATE_A_PRIMEIRA);
  return A;
}

cenario("contador parado nao faz a sirene voltar com a fila vazia (C1)", () => {
  const A = contadorParadoComFilaVazia();
  ok("a consulta calou", !A.estado().tocando);
  const antes = A.sons.length;
  avancarConsultando(A, 180 * SEG, () => filaReal([]));
  ok("nenhum toque em 3 min", A.sons.length === antes, A.sons.length - antes + " toques");
  ok("nao esta tocando", !A.estado().tocando);
});

cenario("depois do 0 da rede, o contador MUDANDO ainda e chegada (C1)", () => {
  const A = contadorParadoComFilaVazia();
  A.mostrarTela(telaFila(2, PAC));
  A.avancar(4 * SEG);
  ok("tocou", A.estado().tocando === true);
});

cenario("depois do 0 da rede, o toast ainda e chegada (C1)", () => {
  const A = contadorParadoComFilaVazia();
  A.toast();
  ok("tocou", A.estado().tocando === true);
});

/* C2: o lembrete volta a ser armado quando a contagem sobe sem id novo */
cenario("abertura com esqueleto 0 e paciente pela rede: lembrete soa (C2)", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.appBuscaFila(filaReal([{ c: "c1" }]));
  A.mostrarTela(telaFila(1, PAC));
  avancarConsultando(A, 3 * 60 * SEG, UM);
  ok("tocou em 3 min", A.sons.length > 0, A.sons.length + " toques");
});

cenario("abertura com esqueleto 0, discreto: lembrete soa (C2)", () => {
  const A = ligar({ intensidade: "discreto", tela: telaFila(0, []) });
  A.appBuscaFila(filaReal([{ c: "c1" }]));
  A.mostrarTela(telaFila(1, PAC));
  avancarConsultando(A, 3 * 60 * SEG, UM);
  ok("tocou em 3 min", A.sons.length > 0, A.sons.length + " toques");
});

cenario("claim 2xx de quem nao esta na fila nao desconta (C2)", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(1, PAC) });
  A.appBuscaFila(UM());
  A.claim("outra-consulta", 201);
  ok("continua 1 aguardando", A.estado().aguardando === 1, String(A.estado().aguardando));
  A.mostrarTela(telaSemContador()); // so a consulta fala: nada de contador parado ajudando
  avancarConsultando(A, 3 * 60 * SEG, UM);
  ok("o lembrete tocou", A.sons.length > 0, A.sons.length + " toques");
});

cenario("claim 2xx fora da tela da fila nao desconta (C2)", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(1, PAC) });
  A.appBuscaFila(UM());
  A.mostrarTela(telaSemContador("Consulta"));
  A.claim("c1", 201);
  ok("continua 1 aguardando", A.estado().aguardando === 1, String(A.estado().aguardando));
});

cenario("clique em Atender e claim que falha: o lembrete volta (C2)", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(1, PAC) });
  A.appBuscaFila(UM());
  A.clicarNaPagina(A.botao("Atender"));
  A.mostrarTela(telaSemContador("Consulta"));
  A.claim("c1", 500);
  ok("o clique descontou", A.estado().aguardando === 0, String(A.estado().aguardando));
  avancarConsultando(A, 3 * 60 * SEG, UM);
  ok("a consulta trouxe o paciente de volta e o lembrete tocou", A.sons.length > 0, A.sons.length + " toques");
});

/* I3: a barra "A fila mudou" nao fica na consulta e nunca recarrega a pagina */
cenario("barra some quando o contador sai da tela (I3)", () => {
  const A = pacienteSaiu();
  ok("barra visivel no PA", !A.stub("mb-fila-mudou").hidden);
  A.mostrarTela(telaSemContador("Consulta"));
  A.avancar(4 * SEG);
  ok("barra escondida na consulta", A.stub("mb-fila-mudou").hidden);
});

cenario("barra some no claim 2xx (I3)", () => {
  const A = pacienteSaiu();
  A.claim("p2", 201);
  ok("barra escondida", A.stub("mb-fila-mudou").hidden);
});

cenario("sem o menu, o botao so esconde a barra — nunca recarrega (I3)", () => {
  const A = pacienteSaiu();
  const { el } = require("./helpers/ambiente-alarme");
  A.mostrarTela(el("div", "", [el("div", "", [el("span", "Aguardando"), el("div", "1"), el("span", "na fila agora")])]));
  let erro = null;
  try { A.clicar("mb-atualizar-fila"); } catch (e) { erro = e; }
  ok("sem excecao", erro === null, erro && erro.message);
  ok("nao recarregou", A.recargas() === 0, String(A.recargas()));
  ok("barra escondida", A.stub("mb-fila-mudou").hidden);
});

/* I4: lembrete na hora, com leitura velha, pede a consulta e decide na resposta */
function lembreteComLeituraVelha(intensidade) {
  const A = ligar({ intensidade, tela: telaSemContador() });
  A.appBuscaFila(UM());                         // t=0: base 1, lembrete para t=60
  A.respostasDeFetch.push({ status: 500 });     // t=15
  A.respostasDeFetch.push({ status: 500 });     // t=45 (recuo de 30 s)
  A.respostasDeFetch.push({ status: 200, corpo: UM() }); // a consulta pedida pelo lembrete
  A.avancar(59 * SEG);
  return A;
}

cenario("reengate com leitura velha consulta na hora e toca (I4)", () => {
  const A = lembreteComLeituraVelha("completo");
  ok("nada antes do minuto", A.sons.length === 0, String(A.sons.length));
  A.avancar(2 * SEG);
  ok("tocou no minuto", A.sons.length > 0, A.sons.length + " toques");
  ok("3 consultas (a ultima pedida pelo lembrete)", A.chamadasDeFetch.length === 3, String(A.chamadasDeFetch.length));
});

cenario("repique do discreto com leitura velha consulta na hora e toca (I4)", () => {
  const A = lembreteComLeituraVelha("discreto");
  A.avancar(2 * SEG);
  ok("tocou no minuto", A.sons.length > 0, A.sons.length + " toques");
});

cenario("consulta pedida pelo lembrete com fila vazia nao toca (I4)", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador() });
  A.appBuscaFila(UM());
  A.respostasDeFetch.push({ status: 500 }, { status: 500 }, { status: 200, corpo: filaReal([]) });
  A.avancar(61 * SEG);
  ok("nenhum toque", A.sons.length === 0, A.sons.length + " toques");
  ok("fila zerada", A.estado().aguardando === 0, String(A.estado().aguardando));
});

cenario("consulta suspensa aparece no painel e some ao retomar (I4)", () => {
  const A = ligar({ intensidade: "completo" });
  A.appBuscaFila(filaReal([]));
  A.respostasDeFetch.push({ status: 401 });
  A.avancar(ATE_A_PRIMEIRA);
  const aviso = "A consulta automática da fila parou (sessão expirada?). Abra o Pronto atendimento para retomar.";
  ok("o painel avisa", A.stub("mb-estado").textContent.indexOf(aviso) >= 0, A.stub("mb-estado").textContent);
  A.appBuscaFila(filaReal([]), { headers: { Authorization: "Bearer novo" } });
  ok("retomada: o aviso some", A.stub("mb-estado").textContent.indexOf(aviso) < 0, A.stub("mb-estado").textContent);
});

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
