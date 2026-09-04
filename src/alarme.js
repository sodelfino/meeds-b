/* ------------------------------------------------------------------
 * src/alarme.js — o alarme de fila do Meeds Doctor
 * ------------------------------------------------------------------
 * COMO ELE DECIDE
 * Dois sinais podem DISPARAR (chegou alguem):
 *   - o toast do proprio app ("Novo paciente na fila");
 *   - um id novo na resposta de /api/doctor/queues/mine.
 * Um sinal responde QUANTOS e QUANDO PARAR:
 *   - o contador "Aguardando" do Pronto Atendimento.
 *
 * A primeira leitura de cada fonte NUNCA dispara: ela so estabelece a
 * base. Sem isso, ligar o alarme com gente ja esperando faria a sirene
 * tocar de imediato para pacientes que o medico ja conhecia.
 *
 * COMO ELE AVISA (escada de atencao — ver src/atencao.js)
 *   medico na aba, olhando  -> som + banner
 *   aba de fundo            -> contador no titulo e no favicone
 *   fora do navegador       -> notificacao do sistema, clicavel
 *   ninguem reagiu          -> reengate em 5 min, e renotifica
 * A escada existe porque alarme mais alto nao resolve: o que resolve e
 * chegar no canal onde o medico esta. Ver o README.
 *
 * PRIVACIDADE: nenhum dado de paciente e lido, gravado ou exibido. O
 * aviso fala em quantidade e tempo. Em disco vao so as preferencias do
 * medico (ligado, som, volume).
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var Fila = raiz.MeedsBFila;
  var Atencao = raiz.MeedsBAtencao;
  var SONS = raiz.MeedsBSom;

  var CHAVE_CONFIG = "meeds-b:config";
  var PADRAO = { ativo: true, som: "sirene-classica", volume: 70 };

  var DEBOUNCE_MS = 2500;         // dois sinais da mesma chegada = um alarme
  var DURACAO_MAX_SOM_MS = 120000; // trava: a sirene nunca toca para sempre
  var REENGATE_MS = 300000;        // silenciar sem atender: volta em 5 min
  var INTERVALO_DOM_MS = 4000;

  var config = null;
  var shadow = null;
  var elBotao = null;
  var elBanner = null;
  var elMoldura = null;
  var elPainel = null;

  var audioCtx = null;
  var tocando = false;
  var intervaloSirene = null;
  var timeoutLimite = null;
  var timeoutReengate = null;
  var timers = [];
  var pararToast = null;
  var pararSuspensao = null;

  var idsVistos = null;           // null = ainda nao ha base
  var ultimoContador = null;
  var ultimoDisparo = 0;
  var chegadaEm = null;           // quando o alarme comecou a tocar

  /* ---------------- preferencias ---------------- */

  function ler() {
    try {
      if (typeof GM_getValue === "function") return GM_getValue(CHAVE_CONFIG, null);
      var t = localStorage.getItem(CHAVE_CONFIG);
      return t ? JSON.parse(t) : null;
    } catch (e) {
      return null;
    }
  }

  function gravar() {
    try {
      if (typeof GM_setValue === "function") GM_setValue(CHAVE_CONFIG, config);
      else localStorage.setItem(CHAVE_CONFIG, JSON.stringify(config));
    } catch (e) {
      /* silencioso: preferencia perdida nao pode derrubar o alarme */
    }
  }

  function carregarConfig() {
    var guardado = ler() || {};
    config = {
      ativo: guardado.ativo !== false,
      som: SONS[guardado.som] ? guardado.som : PADRAO.som,
      volume: Math.min(100, Math.max(0, parseInt(guardado.volume, 10) || PADRAO.volume)),
    };
  }

  /* ---------------- som ---------------- */

  function contexto() {
    if (!audioCtx) {
      var Ctor = raiz.AudioContext || raiz.webkitAudioContext;
      if (!Ctor) return null;
      audioCtx = new Ctor();
    }
    if (audioCtx.state === "suspended") audioCtx.resume().catch(function () {});
    return audioCtx;
  }

  function tocarUmaVez() {
    try {
      var ctx = contexto();
      if (!ctx) return;
      (SONS[config.som] || SONS[PADRAO.som]).tocar(ctx, config.volume / 100);
    } catch (e) {
      /* silencioso */
    }
  }

  /* ---------------- alarme ---------------- */

  function quantosAguardando() {
    return ultimoContador === null ? 0 : ultimoContador;
  }

  function textoDoMotivo() {
    var n = quantosAguardando();
    var partes = [];
    if (n > 0) partes.push(n + " aguardando");
    if (chegadaEm) {
      var min = Math.floor((Date.now() - chegadaEm) / 60000);
      if (min >= 1) partes.push("tocando há " + min + " min");
    }
    return partes.join(" · ") || "Novo paciente na fila";
  }

  function sinalizarChegada(origem) {
    if (!config.ativo) return;
    var agora = Date.now();
    if (agora - ultimoDisparo < DEBOUNCE_MS) return; // toast + rede = um alarme
    ultimoDisparo = agora;
    console.debug("[Meeds B] chegada detectada por", origem);
    dispararAlarme();
  }

  function dispararAlarme() {
    if (tocando) return;
    tocando = true;
    chegadaEm = Date.now();
    atualizarBanner();
    if (elBanner) elBanner.hidden = false;
    if (elMoldura) elMoldura.hidden = false;
    marcarAtencao(true);
    tocarUmaVez();
    var tipo = SONS[config.som] || SONS[PADRAO.som];
    intervaloSirene = setInterval(tocarUmaVez, tipo.intervaloMs);
    /* Trava de seguranca: uma sirene que ninguem silencia nao pode tocar
     * o plantao inteiro. Ao bater o limite ela faz uma parada COMPLETA,
     * que devolve `tocando` a false — senao o alarme travaria em silencio
     * para sempre depois da primeira vez. */
    timeoutLimite = setTimeout(silenciarComReengate, DURACAO_MAX_SOM_MS);
  }

  function pararSom() {
    if (intervaloSirene) { clearInterval(intervaloSirene); intervaloSirene = null; }
    if (timeoutLimite) { clearTimeout(timeoutLimite); timeoutLimite = null; }
  }

  function silenciarAlarme() {
    if (timeoutReengate) { clearTimeout(timeoutReengate); timeoutReengate = null; }
    pararSom();
    tocando = false;
    chegadaEm = null;
    if (elBanner) elBanner.hidden = true;
    if (elMoldura) elMoldura.hidden = true;
    /* O distintivo NAO some aqui: silenciar o som nao tira o paciente da
     * fila. Ele so some quando a fila esvazia. */
    marcarAtencao(false);
  }

  /* "Estou indo" — nao e "ignorar". Se o medico nao atender de fato, o
   * alarme volta, que e o acknowledge do plantao de software. */
  function silenciarComReengate() {
    var haviaFila = quantosAguardando() > 0;
    silenciarAlarme();
    if (!haviaFila) return;
    timeoutReengate = setTimeout(function () {
      timeoutReengate = null;
      if (config.ativo && quantosAguardando() > 0) dispararAlarme();
    }, REENGATE_MS);
  }

  function marcarAtencao(podeNotificar) {
    if (!Atencao) return;
    var n = quantosAguardando();
    if (n <= 0) { Atencao.limpar(); return; }
    Atencao.marcar({
      contagem: n,
      notificar: !!podeNotificar,
      titulo: "Paciente na fila",
      corpo: textoDoMotivo(),
      tag: "meeds-b-fila",
      exigeInteracao: true,
      aoClicar: silenciarComReengate,
    });
  }

  /* ---------------- sinais ---------------- */

  function lerContadorEReagir() {
    var n = Fila.lerContadorAguardando();
    if (n === null) return; // fora do Pronto Atendimento: nada a dizer
    var anterior = ultimoContador;
    ultimoContador = n;

    if (anterior !== null && n > anterior) sinalizarChegada("contador-dom");
    if (n === 0 && tocando) silenciarAlarme();   // fila esvaziou: cala sozinho
    if (tocando) atualizarBanner();
    if (n > 0 || anterior !== null) marcarAtencao(false);
  }

  function aoResponderFila(json) {
    var ids;
    try {
      ids = Fila.idsDeFolhas(json);
    } catch (e) {
      return; // formato inesperado: os outros sinais cobrem
    }
    if (!ids.length && idsVistos === null) { idsVistos = {}; return; }

    var atual = {};
    var novo = false;
    for (var i = 0; i < ids.length; i++) {
      atual[ids[i]] = true;
      if (idsVistos && !idsVistos[ids[i]]) novo = true;
    }
    /* A primeira resposta so estabelece a base — nunca dispara. */
    if (idsVistos !== null && novo) sinalizarChegada("rede-queues-mine");
    idsVistos = atual;
  }

  /* ------------------------------------------------------------------
   * ESCUTA DE REDE
   * ------------------------------------------------------------------
   * So LEITURA do que a propria tela ja pediu: o gancho copia a resposta
   * e devolve a original intacta. Nenhuma requisicao e criada por nos,
   * nenhum dado de outro profissional e consultado — /queues/mine e, por
   * definicao, a fila do medico logado.
   * ------------------------------------------------------------------ */
  function instalarEscutaDeRede() {
    var fetchOriginal = raiz.fetch;
    if (typeof fetchOriginal === "function") {
      raiz.fetch = function (entrada, opcoes) {
        var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
        var promessa = fetchOriginal.apply(this, arguments);
        if (Fila.ehChamadaDaFila(url)) {
          promessa
            .then(function (resposta) {
              /* clone(): ler o corpo consome o stream, e consumir o
               * original deixaria a tela sem os dados dela. */
              resposta.clone().json().then(aoResponderFila).catch(function () {});
              return resposta;
            })
            .catch(function () {});
        }
        return promessa;
      };
    }

    var abrirOriginal = raiz.XMLHttpRequest && raiz.XMLHttpRequest.prototype.open;
    if (abrirOriginal) {
      raiz.XMLHttpRequest.prototype.open = function (metodo, url) {
        this.__meedsBUrl = url;
        return abrirOriginal.apply(this, arguments);
      };
      var enviarOriginal = raiz.XMLHttpRequest.prototype.send;
      raiz.XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (Fila.ehChamadaDaFila(xhr.__meedsBUrl)) {
          xhr.addEventListener("load", function () {
            try {
              if (xhr.status === 200) aoResponderFila(JSON.parse(xhr.responseText));
            } catch (e) {
              /* silencioso */
            }
          });
        }
        return enviarOriginal.apply(this, arguments);
      };
    }
  }

  /* ---------------- interface ---------------- */

  var CSS = [
    ":host { all: initial; }",
    "#mb-botao {",
    "  position: fixed; right: 20px; bottom: 20px; z-index: 2147483000;",
    "  width: 52px; height: 52px; border-radius: 50%; border: none; cursor: pointer;",
    "  font-size: 22px; line-height: 1; color: #fff; font-family: system-ui, sans-serif;",
    "  box-shadow: 0 6px 20px rgba(0,0,0,.28);",
    "}",
    "#mb-botao.ligado { background: linear-gradient(135deg,#0ea5a4,#0f766e); }",
    "#mb-botao.desligado { background: #64748b; }",
    "#mb-banner {",
    "  position: fixed; top: 0; left: 0; right: 0; z-index: 2147483001;",
    "  display: flex; align-items: center; justify-content: center; gap: 14px; flex-wrap: wrap;",
    "  padding: 13px 18px; color: #fff; font: 700 16px system-ui, sans-serif;",
    "  background: linear-gradient(90deg,#dc2626,#f97316,#dc2626); background-size: 200% 100%;",
    "  animation: mb-desliza 1.1s linear infinite;",
    "}",
    "#mb-banner[hidden], #mb-moldura[hidden], #mb-painel[hidden] { display: none; }",
    "@keyframes mb-desliza { from { background-position: 0 0; } to { background-position: 200% 0; } }",
    "#mb-motivo { font-weight: 500; font-size: 14px; opacity: .95; }",
    "#mb-banner button {",
    "  background: rgba(255,255,255,.2); border: 1.5px solid rgba(255,255,255,.75); color: #fff;",
    "  padding: 7px 15px; border-radius: 8px; font: 700 14px system-ui, sans-serif; cursor: pointer;",
    "}",
    "#mb-moldura {",
    "  position: fixed; inset: 0; z-index: 2147482999; pointer-events: none;",
    "  box-shadow: inset 0 0 0 6px rgba(220,38,38,.9), inset 0 0 60px rgba(220,38,38,.35);",
    "  animation: mb-pulsa 1.1s ease-in-out infinite;",
    "}",
    "@keyframes mb-pulsa {",
    "  0%,100% { box-shadow: inset 0 0 0 6px rgba(220,38,38,.9), inset 0 0 60px rgba(220,38,38,.35); }",
    "  50% { box-shadow: inset 0 0 0 12px rgba(248,113,113,1), inset 0 0 110px rgba(220,38,38,.6); }",
    "}",
    /* Quem pediu menos movimento no sistema nao esta pedindo menos
       alarme: o som, o vermelho e o texto continuam. So para de pulsar. */
    "@media (prefers-reduced-motion: reduce) { #mb-banner, #mb-moldura { animation: none !important; } }",
    "#mb-painel {",
    "  position: fixed; right: 20px; bottom: 84px; z-index: 2147483002; width: 320px;",
    "  background: #fff; color: #16221f; border-radius: 14px; padding: 16px 18px 18px;",
    "  box-shadow: 0 20px 60px rgba(0,0,0,.3); font: 400 13px system-ui, sans-serif;",
    "}",
    "#mb-painel h2 { margin: 0 0 12px; font-size: 15px; }",
    "#mb-painel label { display: block; font-size: 12px; font-weight: 600; color: #334155; margin: 12px 0 5px; }",
    "#mb-painel select, #mb-painel input[type=range] { width: 100%; box-sizing: border-box; }",
    "#mb-painel select { padding: 8px; border-radius: 8px; border: 1.5px solid #cbd5e1; font: inherit; }",
    "#mb-estado { font-size: 11.5px; color: #475569; line-height: 1.5; margin-top: 12px; }",
    "#mb-painel button.acao {",
    "  margin-top: 10px; width: 100%; padding: 9px; border-radius: 9px; cursor: pointer;",
    "  border: 1.5px solid #0f766e; background: #fff; color: #0f766e; font: 700 12.5px system-ui, sans-serif;",
    "}",
    "#mb-liberar[hidden] { display: none; }",
  ].join("\n");

  function montarUI() {
    var host = document.createElement("div");
    host.id = "meeds-b-host";
    (document.body || document.documentElement).appendChild(host);
    shadow = host.attachShadow({ mode: "open" });

    var estilo = document.createElement("style");
    estilo.textContent = CSS;
    shadow.appendChild(estilo);

    shadow.innerHTML +=
      '<div id="mb-moldura" hidden></div>' +
      '<div id="mb-banner" hidden>' +
      "  <span>🚨 Novo paciente na fila!</span>" +
      '  <span id="mb-motivo"></span>' +
      '  <button type="button" id="mb-silenciar">Silenciar alarme</button>' +
      "</div>" +
      '<button type="button" id="mb-botao" title="Alarme de fila"></button>' +
      '<div id="mb-painel" hidden>' +
      "  <h2>Alarme de fila</h2>" +
      '  <label for="mb-som">Som</label><select id="mb-som"></select>' +
      '  <label for="mb-volume">Volume</label><input type="range" id="mb-volume" min="0" max="100" step="5" />' +
      '  <button type="button" class="acao" id="mb-testar">🔊 Testar som</button>' +
      '  <div id="mb-estado"></div>' +
      '  <button type="button" class="acao" id="mb-liberar" hidden>Ativar avisos do sistema</button>' +
      "</div>";

    elMoldura = shadow.getElementById("mb-moldura");
    elBanner = shadow.getElementById("mb-banner");
    elBotao = shadow.getElementById("mb-botao");
    elPainel = shadow.getElementById("mb-painel");

    var sel = shadow.getElementById("mb-som");
    Object.keys(SONS).forEach(function (id) {
      var o = document.createElement("option");
      o.value = id;
      o.textContent = SONS[id].nome;
      sel.appendChild(o);
    });

    elBotao.addEventListener("click", function (ev) {
      if (ev.shiftKey) return abrirPainel();
      config.ativo = !config.ativo;
      gravar();
      if (!config.ativo) silenciarAlarme();
      refletir();
    });
    elBotao.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      abrirPainel();
    });
    shadow.getElementById("mb-silenciar").addEventListener("click", silenciarComReengate);
    sel.addEventListener("change", function () { config.som = sel.value; gravar(); });
    shadow.getElementById("mb-volume").addEventListener("input", function (ev) {
      config.volume = parseInt(ev.target.value, 10);
      gravar();
    });
    shadow.getElementById("mb-testar").addEventListener("click", function () {
      contexto();
      tocarUmaVez();
    });
    shadow.getElementById("mb-liberar").addEventListener("click", function () {
      if (!Atencao) return;
      Atencao.pedirPermissaoDeNotificacao().then(function (liberou) {
        refletirEstado();
        /* O Edge silencia esse pedido de fabrica e so pisca um sino na
         * barra de endereco. Sem esta linha o medico clica e parece que
         * nada aconteceu. */
        if (!liberou && Atencao.permissaoDeNotificacao() === "default") {
          shadow.getElementById("mb-estado").textContent =
            "O navegador não mostrou a pergunta — ele silencia esse pedido por padrão. " +
            "Procure o ícone de sino na barra de endereço e escolha permitir.";
        }
      });
    });

    document.addEventListener("click", function (ev) {
      if (!elPainel || elPainel.hidden) return;
      if (!ev.composedPath || ev.composedPath().indexOf(host) === -1) elPainel.hidden = true;
    });

    refletir();
  }

  function abrirPainel() {
    elPainel.hidden = !elPainel.hidden;
    if (!elPainel.hidden) refletirEstado();
  }

  function atualizarBanner() {
    var el = shadow && shadow.getElementById("mb-motivo");
    if (el) el.textContent = textoDoMotivo();
  }

  function refletir() {
    if (!elBotao) return;
    elBotao.textContent = config.ativo ? "🔔" : "🔕";
    elBotao.className = config.ativo ? "ligado" : "desligado";
    elBotao.title =
      (config.ativo ? "Alarme LIGADO" : "Alarme desligado") +
      " — clique para alternar, clique direito para configurar";
    if (shadow) {
      shadow.getElementById("mb-som").value = config.som;
      shadow.getElementById("mb-volume").value = config.volume;
    }
  }

  /* O aviso do sistema nao e uma chave: e como o alarme funciona. O que
   * o limita e PERMISSAO do navegador, e permissao nao se resolve com um
   * liga/desliga — se resolve pedindo. A tela diz o estado e oferece o
   * unico passo que resolve, quando existe um. */
  function refletirEstado() {
    if (!shadow) return;
    var estado = shadow.getElementById("mb-estado");
    var botao = shadow.getElementById("mb-liberar");
    var permissao = Atencao ? Atencao.permissaoDeNotificacao() : "indisponivel";
    botao.hidden = permissao !== "default";

    if (permissao === "granted") {
      estado.textContent =
        "Avisos do sistema ligados. Aparecem com o navegador minimizado; clicar traz a aba " +
        "para frente e silencia — se você não atender, o alarme volta em 5 minutos.";
    } else if (permissao === "denied") {
      estado.textContent =
        "As notificações estão bloqueadas para este site. Libere no cadeado da barra de " +
        "endereço para ser avisado fora da aba. O alarme continua tocando aqui dentro.";
    } else if (permissao === "indisponivel") {
      estado.textContent =
        "Este navegador não oferece notificação do sistema. O alarme continua tocando nesta aba.";
    } else {
      estado.textContent =
        "Você pode ser avisado mesmo com o navegador minimizado. O navegador pede sua " +
        "autorização uma vez.";
    }
    if (Atencao && Atencao.suportaTelaAcesa()) {
      estado.textContent += " A tela não apaga enquanto esta aba estiver aberta.";
    }
  }

  /* ---------------- ligar tudo ---------------- */

  function iniciar() {
    carregarConfig();
    instalarEscutaDeRede();

    function quandoTiverCorpo() {
      if (!document.body) return setTimeout(quandoTiverCorpo, 200);
      montarUI();
      pararToast = Fila.observarToast(function () { sinalizarChegada("toast-do-app"); });
      timers.push(setInterval(lerContadorEReagir, INTERVALO_DOM_MS));
      lerContadorEReagir();
      if (Atencao) {
        Atencao.manterTelaAcesa(true);
        pararSuspensao = Atencao.aoAcordarDeSuspensao(function (atrasoMs) {
          if (!config.ativo) return;
          var min = Math.round(atrasoMs / 60000);
          if (min < 2) return;
          console.warn("[Meeds B] aba suspensa por ~" + min + " min; o alarme nao pode tocar.");
          alertarSuspensao(min);
        });
      }
      console.debug("[Meeds B] alarme de fila no ar.");
    }
    quandoTiverCorpo();
  }

  /* Aba suspensa pelo navegador (o Edge faz isso de fabrica) para os
   * timers: a tela deixa de consultar a fila e o alarme simplesmente nao
   * toca — sem erro, sem aviso. Nao da para impedir pela pagina; da para
   * contar ao medico que houve um periodo sem vigilancia. */
  function alertarSuspensao(min) {
    if (!shadow) return;
    var el = shadow.getElementById("mb-estado");
    elPainel.hidden = false;
    if (el) {
      el.textContent =
        "Esta aba ficou suspensa pelo navegador por cerca de " + min +
        " min e o alarme não pôde tocar nesse período. Confira a fila.";
    }
  }

  raiz.MeedsB = {
    iniciar: iniciar,
    /* expostos para teste */
    _sinalizarChegada: function (o) { sinalizarChegada(o); },
    _aoResponderFila: function (j) { aoResponderFila(j); },
    _estado: function () {
      return { tocando: tocando, aguardando: quantosAguardando(), ativo: config && config.ativo };
    },
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
