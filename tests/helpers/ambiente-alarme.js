/* ------------------------------------------------------------------
 * tests/helpers/ambiente-alarme.js — roda o alarme de verdade, sem navegador
 * ------------------------------------------------------------------
 * POR QUE ISTO EXISTE
 * src/alarme.js e a maquina de estados que decide se um medico e avisado
 * ou nao, e ate a v1.4.0 nao tinha NENHUM teste: os tres arquivos de
 * teste cobriam a leitura da fila, o som e a escada de atencao, mas nao
 * o que junta tudo. Toda a classe de defeito "paciente preso" mora nesse
 * junta-tudo — um timer cancelado por outra funcao, um contador que nao
 * e zerado, um sinal que chega duas vezes — e nenhum teste de unidade de
 * um modulo isolado a enxerga.
 *
 * O QUE ESTE AMBIENTE FAZ
 * Carrega os QUATRO fontes reais (atencao, som, fila, alarme) num `vm`,
 * com:
 *   - relogio e timers virtuais: avancar(ms) dispara tudo na ordem certa;
 *   - uma tela do Meeds Doctor de mentira (cartao "Aguardando", linhas de
 *     paciente com selo de cidade, a tela de Agenda sem contador);
 *   - a UI do proprio alarme como "stubs" que gravam o que o codigo faz;
 *   - Notification, AudioContext, MutationObserver, XMLHttpRequest e fetch
 *     falsos. O fetch responde de forma SINCRONA (um "thenable" que chama o
 *     callback na hora), para a resposta da consulta propria ser processada
 *     dentro do mesmo avancar() que a disparou, como no navegador.
 *
 * O som e substituido por um contador (sons[]), porque o que importa para
 * o medico e QUANDO tocou, nao a forma de onda.
 * ------------------------------------------------------------------ */
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..", "..");
const FONTES = ["src/atencao.js", "src/som.js", "src/fila.js", "src/alarme.js"];

/* ---------- a tela do Meeds Doctor ---------- */

function el(tag, texto, filhos) {
  const e = { tagName: String(tag).toUpperCase(), children: filhos || [], parentElement: null, _texto: texto || "" };
  e.children.forEach((f) => (f.parentElement = e));
  Object.defineProperty(e, "textContent", {
    get() {
      return e.children.length ? e.children.map((f) => f.textContent).join("") : e._texto;
    },
  });
  return e;
}

function todos(no, saida) {
  saida.push(no);
  no.children.forEach((f) => todos(f, saida));
  return saida;
}

/* Pronto Atendimento como visto na gravacao: cartao "Aguardando", e uma
 * linha por paciente com nome, selo de cidade, marcador "Novo" e o botao
 * "Atender". pacientes = [{ nome, cidade, novo }] */
function telaFila(aguardando, pacientes) {
  const cartao = el("div", "", [el("span", "Aguardando"), el("div", String(aguardando)), el("span", "na fila agora")]);
  const linhas = (pacientes || []).map((p) =>
    el("div", "", [
      el("div", "", []),
      el("div", "", [el("div", p.nome), el("div", "", [el("span", p.cidade)])]),
      el("div", "", [p.novo === false ? el("span", "2 min") : el("span", "Novo"), el("button", "Atender")]),
    ])
  );
  return el("div", "", [cartao].concat(linhas));
}

/* Agenda e tela de consulta: o contador "Aguardando" nao existe aqui (F5). */
function telaSemContador(titulo) {
  return el("div", "", [el("h1", titulo || "Agenda"), el("div", "12")]);
}

/* O corpo real de /api/doctor/queues/mine (formato observado em 14/10).
 * itens = [{ c: consultationId, p: patient.id, em: checkedInAt ISO }] — vao na fila "Teste". */
function filaReal(itens) {
  const lista = itens || [];
  return [
    { queue: { id: "q-pa", careLine: "medica", label: "Pronto atendimento", isAvailable: true },
      status: "ok", items: [], stats: { waiting: 0, inProgress: 0, completedToday: 2, avgDurationMinutes: 7 } },
    { queue: { id: "q-teste", careLine: "medica", label: "Teste", specialty: "GENERALISTA", isAvailable: true },
      status: "ok",
      items: lista.map((i) => {
        const item = { priority: "normal", tenantId: "macae", waitingSince: "2026-10-14T14:21:19.471Z",
                       patient: { name: "NOME QUE NUNCA PODE VAZAR", locality: {} } };
        if (i.c) item.consultationId = i.c;
        if (i.p) item.patient.id = i.p;
        if (i.em) item.checkedInAt = i.em;
        return item;
      }),
      stats: { waiting: lista.length, inProgress: 0, completedToday: 0, avgDurationMinutes: 0 } },
  ];
}

/* ---------- o ambiente ---------- */

function criarAmbiente(opcoes) {
  const o = opcoes || {};
  let agora = 1700000000000;
  let seq = 1;
  const agendados = new Map();
  const logs = [];
  const notificacoes = [];
  const sons = [];
  const stubs = {};
  const armazem = {};
  const ouvintesDoc = {};
  let tela = el("div", "", []);
  let foraDaAba = false;
  let aoMutar = null;

  function agendar(fn, ms, repete) {
    const id = seq++;
    agendados.set(id, { quando: agora + (ms || 0), fn, intervalo: repete ? ms : null });
    return id;
  }

  function avancar(ms) {
    const alvo = agora + ms;
    for (;;) {
      let proxId = null;
      let prox = null;
      agendados.forEach((t, id) => {
        if (t.quando > alvo) return;
        if (prox === null || t.quando < prox.quando || (t.quando === prox.quando && id < proxId)) {
          prox = t;
          proxId = id;
        }
      });
      if (prox === null) break;
      agora = prox.quando;
      if (prox.intervalo) prox.quando += prox.intervalo;
      else agendados.delete(proxId);
      prox.fn();
    }
    agora = alvo;
  }

  function novoStub(tag) {
    const e = {
      tagName: String(tag || "div").toUpperCase(), children: [], hidden: false, style: {},
      textContent: "", value: "", innerHTML: "", disabled: false, checked: false, offsetHeight: 0, id: "",
      classList: { add() {}, remove() {} }, _attrs: {}, _ouvintes: {},
      appendChild(f) { e.children.push(f); return f; },
      setAttribute(k, v) { e._attrs[k] = String(v); },
      getAttribute(k) { return k in e._attrs ? e._attrs[k] : null; },
      removeAttribute(k) { delete e._attrs[k]; },
      addEventListener(ev, fn) { (e._ouvintes[ev] = e._ouvintes[ev] || []).push(fn); },
      removeEventListener() {},
      attachShadow() { return criarShadow(); },
      getContext() { return null; },
      toDataURL() { return ""; },
    };
    return e;
  }

  /* O HTML do alarme nao e interpretado aqui, entao o atributo `hidden`
   * que ele declara tem que ser lido do texto: sem isso a faixa, o
   * cartao e o painel nasceriam "visiveis" no teste e mentiriam. */
  let shadowAtual = null;
  function stubDe(id) {
    if (!stubs[id]) {
      const e = novoStub("div");
      const html = shadowAtual ? shadowAtual.innerHTML : "";
      e.hidden = new RegExp('id="' + id + '"[^>]*\\bhidden\\b').test(html);
      stubs[id] = e;
    }
    return stubs[id];
  }

  function criarShadow() {
    const s = {
      innerHTML: "", children: [],
      appendChild(f) { s.children.push(f); return f; },
      getElementById(id) { return stubDe(id); },
    };
    shadowAtual = s;
    return s;
  }

  const documento = {
    title: "Meeds Doctor",
    body: novoStub("body"),
    documentElement: novoStub("html"),
    head: novoStub("head"),
    get visibilityState() { return foraDaAba ? "hidden" : "visible"; },
    hasFocus() { return !foraDaAba; },
    createElement: novoStub,
    querySelector() { return null; },
    querySelectorAll() { return todos(tela, []); },
    addEventListener(ev, fn) { (ouvintesDoc[ev] = ouvintesDoc[ev] || []).push(fn); },
    removeEventListener() {},
  };

  function NotificacaoFalsa(titulo, opts) {
    this.titulo = titulo;
    this.corpo = (opts && opts.body) || "";
    this.fechada = false;
    this.close = () => { this.fechada = true; };
    notificacoes.push(this);
  }
  NotificacaoFalsa.permission = o.permissaoDeNotificacao || "granted";

  function XHRFalso() { this._ouvintes = {}; this.status = 0; this.responseText = ""; this.response = null; }
  XHRFalso.prototype.open = function (m, u) { this._url = u; };
  XHRFalso.prototype.setRequestHeader = function () {};
  XHRFalso.prototype.send = function () {};
  XHRFalso.prototype.addEventListener = function (ev, fn) {
    (this._ouvintes[ev] = this._ouvintes[ev] || []).push(fn);
  };

  /* fetch falso: cada chamada consome a proxima de respostasDeFetch
   * ({status, corpo} ou "pendurar"); com a fila vazia, pendura — assim os
   * testes antigos, que nao pensam em consulta, nao recebem fila nenhuma. */
  const respostasDeFetch = [];
  const chamadasDeFetch = [];
  function resolvido(v) {
    return {
      then(f) {
        try { const x = f ? f(v) : v; return x && typeof x.then === "function" ? x : resolvido(x); }
        catch (e) { return rejeitado(e); }
      },
      catch() { return this; },
    };
  }
  function rejeitado(e) {
    return {
      then(f, r) { return r ? resolvido(e).then(r) : this; },
      catch(r) { return this.then(null, r); },
    };
  }
  const pendurado = { then() { return pendurado; }, catch() { return pendurado; } };
  function fetchFalso(url, opcoes) {
    chamadasDeFetch.push({ url, opcoes });
    const r = respostasDeFetch.shift();
    if (!r || r === "pendurar") return pendurado;
    const resposta = {
      status: r.status, ok: r.status >= 200 && r.status < 300,
      json() { return resolvido(r.corpo); },
      clone() { return resposta; },
    };
    return resolvido(resposta);
  }

  class DataFalsa extends Date { static now() { return agora; } }

  const janelas = [];
  armazem["meeds-b:config"] = JSON.stringify({ intensidade: o.intensidade || "completo", janela: !!o.janela });
  /* `guardado`: preferencia ja gravada, lida pelo GM_getValue (como no
   * Tampermonkey) em vez do localStorage. O objeto e o "disco". */
  const disco = {};
  if (o.guardado) disco["meeds-b:config"] = o.guardado;

  const ctx = {
    console: {
      debug: (...a) => logs.push(a.join(" ")),
      warn: (...a) => logs.push("WARN " + a.join(" ")),
      log: (...a) => logs.push(a.join(" ")),
      error: (...a) => logs.push("ERROR " + a.join(" ")),
    },
    document: documento,
    setTimeout: (fn, ms) => agendar(fn, ms, false),
    setInterval: (fn, ms) => agendar(fn, ms, true),
    clearTimeout: (id) => agendados.delete(id),
    clearInterval: (id) => agendados.delete(id),
    Date: DataFalsa,
    localStorage: {
      getItem: (k) => (k in armazem ? armazem[k] : null),
      setItem: (k, v) => { armazem[k] = String(v); },
    },
    AudioContext: function () { this.state = "running"; this.resume = () => Promise.resolve(); },
    Notification: NotificacaoFalsa,
    XMLHttpRequest: XHRFalso,
    fetch: fetchFalso,
    URL,
    location: { origin: "https://doctor.calltechsaude.com.br", href: "https://doctor.calltechsaude.com.br/fila" },
    MutationObserver: function (cb) { aoMutar = cb; this.observe = () => {}; this.disconnect = () => {}; },
    focus() {},
    screen: { width: 1920 },
    open() {
      const j = { closed: false, close() { j.closed = true; }, document: { open() {}, write() {}, close() {} } };
      janelas.push(j);
      return j;
    },
  };
  if (o.guardado) {
    ctx.GM_getValue = (k, padrao) => (k in disco ? disco[k] : padrao);
    ctx.GM_setValue = (k, v) => { disco[k] = v; };
  }
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);

  FONTES.forEach((rel) => {
    vm.runInContext(fs.readFileSync(path.join(RAIZ, rel), "utf8"), ctx, { filename: rel });
    if (rel === "src/som.js") {
      Object.keys(ctx.MeedsBSom).forEach((id) => {
        ctx.MeedsBSom[id].tocar = function () { sons.push({ id, t: agora }); };
      });
    }
  });

  const A = {
    iniciar() { ctx.MeedsB.iniciar(); },
    avancar,
    agora: () => agora,
    notificacoes, sons, logs, janelas, respostasDeFetch, chamadasDeFetch,
    titulo: () => documento.title,
    estado: () => ctx.MeedsB._estado(),
    config: () => ctx.MeedsB._estado().config,
    disco: () => disco,
    ui: (id) => stubDe(id),
    armazenado: () => JSON.stringify(armazem),

    mostrarTela(t) {
      tela = t;
      todos(t, []).forEach((n) => { n.querySelectorAll = () => todos(n, []).slice(1); });
    },
    foraDaAba(v) { foraDaAba = !!v; },

    /* o aviso do proprio app: "Novo paciente na fila — <nome> · <fila>" */
    toast(texto) {
      aoMutar([{ addedNodes: [{ nodeType: 1, textContent: texto || "Novo paciente na fila Fulano de Tal · Teste" }] }]);
    },
    responder(json) { ctx.MeedsB._aoResponderFila(json); },
    responderXHR(corpo, tipo) {
      const x = new ctx.XMLHttpRequest();
      x.open("GET", "https://api.calltechsaude.com.br/api/doctor/queues/mine");
      x.send();
      x.status = 200;
      x.responseType = tipo === "json" ? "json" : "";
      if (tipo === "json") {
        x.response = corpo;
        Object.defineProperty(x, "responseText", { get() { throw new Error("InvalidStateError"); } });
      } else {
        x.responseText = JSON.stringify(corpo);
        x.response = x.responseText;
      }
      (x._ouvintes.load || []).forEach((f) => f());
    },

    /* a tela buscando a fila por XHR, com os cabecalhos dela (ex.: o token) */
    appBuscaFila(corpo, opts) {
      const x = new ctx.XMLHttpRequest();
      x.open("GET", "https://api.calltechsaude.com.br/api/doctor/queues/mine");
      const h = (opts && opts.headers) || {};
      Object.keys(h).forEach((k) => x.setRequestHeader(k, h[k]));
      x.withCredentials = !!(opts && opts.withCredentials);
      x.send();
      x.status = 200;
      x.responseText = JSON.stringify(corpo);
      (x._ouvintes.load || []).forEach((f) => f());
    },

    /* um clique na pagina (fase de captura, como o alarme escuta) */
    clicarNaPagina(alvo) {
      (ouvintesDoc.click || []).forEach((f) => f({ target: alvo, composedPath: () => [] }));
    },
    botao(texto) {
      const b = { tagName: "BUTTON", textContent: texto, closest() { return b; } };
      return b;
    },
    clicar(id) {
      (stubDe(id)._ouvintes.click || []).forEach((f) =>
        f({ shiftKey: false, preventDefault() {}, stopPropagation() {}, target: stubDe(id) })
      );
    },
    mudarIntensidade(valor) {
      (stubDe("mb-intensidade")._ouvintes.change || []).forEach((f) => f({ target: { value: valor } }));
    },

    cartao() {
      return {
        visivel: !stubDe("mb-cartao").hidden,
        titulo: stubDe("mb-cartao-titulo").textContent,
        linhas: stubDe("mb-cartao-corpo").children.map((x) => x.textContent),
      };
    },
    bannerVisivel() { return !stubDe("mb-banner").hidden; },
    motivoDoBanner() { return stubDe("mb-motivo").textContent; },

    /* tudo que o medico (ou uma tela compartilhada) pode ler */
    textosVisiveis() {
      const t = [documento.title];
      notificacoes.forEach((n) => t.push(n.titulo, n.corpo));
      ["mb-cartao-titulo", "mb-motivo", "mb-banner-titulo"].forEach((id) => {
        if (stubs[id]) t.push(stubs[id].textContent);
      });
      if (stubs["mb-cartao-corpo"]) stubs["mb-cartao-corpo"].children.forEach((x) => t.push(x.textContent));
      return t.concat(logs);
    },
  };
  return A;
}

/* Liga o alarme com a tela pedida e deixa o baseline assentar. */
function ligar(opcoes) {
  const o = opcoes || {};
  const A = criarAmbiente(o);
  A.mostrarTela(o.tela || telaFila(0, []));
  A.iniciar();
  A.avancar(o.assentar === undefined ? 4100 : o.assentar);
  return A;
}

module.exports = { criarAmbiente, ligar, telaFila, telaSemContador, filaReal, el };
