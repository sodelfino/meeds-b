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
  /* NAO HA MAIS liga/desliga separado. Ate a v1.1.1 existia uma chave
   * "Alarme ligado" no painel, redundante com a intensidade: desligar o
   * alarme e exatamente o que "🔕 Silencioso" ja faz (nada de som nem de
   * aviso na tela — so o contador). Duas chaves para dizer a mesma coisa
   * confundem mais do que ajudam, e foi exatamente o que o medico
   * reportou: o sino em si parecia "quebrado" ate ele achar a chave
   * escondida no painel. Ver README ("As tres intensidades"). */
  var PADRAO = {
    som: "sirene-classica",       // usado no modo completo (repete)
    somCurto: "toque-duplo",      // usado no modo discreto (toca uma vez)
    volume: 70,
    intensidade: "completo",      // "silencioso" | "discreto" | "completo"
    janela: false,                // pop-up: opcional, nasce desligado
  };

  /* ------------------------------------------------------------------
   * AS TRES INTENSIDADES (o botao de som do Waze)
   * ------------------------------------------------------------------
   * Um alarme com duas posicoes — berrando ou mudo — obriga o medico a
   * escolher entre ser interrompido no meio de uma consulta e nao ficar
   * sabendo que chegou gente. Com tres, ele escolhe quanto de
   * interrupcao cabe no momento, e nao precisa desligar tudo.
   *
   * A escada de atencao (titulo, favicone, notificacao do sistema) vale
   * nos tres: ela e sobre ONDE avisar, nao sobre o quanto incomodar.
   *
   * DIFERENCA EM RELACAO AO ASSISTENTE MEEDS
   * La o modo discreto mostra um cartao com QUEM chegou e DE ONDE. Aqui
   * nao: este script nao le dado de paciente em lugar nenhum (ver o
   * cabecalho de src/fila.js), e trazer o cartao junto contrariaria a
   * propria regra que ele declara. O discreto daqui e som curto e mais
   * nada na tela.
   * ------------------------------------------------------------------ */
  var INTENSIDADES = {
    silencioso: {
      rotulo: "Silencioso",
      icone: "🔕",
      resumo: "Só o contador na aba e no favicone. Nada de som nem de aviso na tela.",
      som: false, banner: false,
    },
    discreto: {
      rotulo: "Discreto",
      icone: "🔉",
      resumo: "Um som curto, uma vez. Sem faixa e sem moldura na tela.",
      som: "curto", banner: false,
    },
    completo: {
      rotulo: "Completo",
      icone: "🔔",
      resumo: "Sirene repetindo, faixa no topo e moldura na tela até você silenciar.",
      som: "repetido", banner: true,
    },
  };

  var ORDEM_INTENSIDADE = ["completo", "discreto", "silencioso"];

  function intensidadeAtual() {
    return INTENSIDADES[config.intensidade] || INTENSIDADES.completo;
  }

  /* O som que vale AGORA depende da intensidade: as sirenes foram feitas
   * para repetir e soam truncadas tocadas uma vez so. Ver src/som.js. */
  function somDaVez() {
    var curto = intensidadeAtual().som === "curto";
    var id = curto ? config.somCurto : config.som;
    var escolhido = SONS[id];
    if (escolhido && !!escolhido.curto === curto) return escolhido;
    /* Preferencia invalida (som removido da biblioteca, ou gravado no
     * campo errado): cai no primeiro da lista certa em vez de ficar mudo. */
    var ids = Object.keys(SONS).filter(function (k) { return !!SONS[k].curto === curto; });
    return SONS[ids[0]];
  }

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
    /* Cada campo e validado contra a biblioteca ATUAL: um som removido
     * numa atualizacao nao pode deixar o alarme mudo. */
    var somOk = SONS[guardado.som] && !SONS[guardado.som].curto;
    var curtoOk = SONS[guardado.somCurto] && SONS[guardado.somCurto].curto;
    var intensidadeGuardada = INTENSIDADES[guardado.intensidade] ? guardado.intensidade : PADRAO.intensidade;
    /* Migracao da chave "ativo" (existiu ate a v1.1.1): quem tinha o
     * alarme desligado por ali continua desligado, so que agora atraves
     * da intensidade — sem perder a preferencia na troca de versao. */
    if (guardado.ativo === false) intensidadeGuardada = "silencioso";
    config = {
      som: somOk ? guardado.som : PADRAO.som,
      somCurto: curtoOk ? guardado.somCurto : PADRAO.somCurto,
      volume: Math.min(100, Math.max(0, parseInt(guardado.volume, 10) || PADRAO.volume)),
      intensidade: intensidadeGuardada,
      janela: guardado.janela === true,
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

  function tocarUmaVez(somEspecifico) {
    try {
      var ctx = contexto();
      if (!ctx) return;
      var som = somEspecifico || somDaVez();
      if (som) som.tocar(ctx, config.volume / 100);
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
    var agora = Date.now();
    if (agora - ultimoDisparo < DEBOUNCE_MS) return; // toast + rede = um alarme
    ultimoDisparo = agora;
    console.debug("[Meeds B] chegada detectada por", origem);
    dispararAlarme();
  }

  function dispararAlarme() {
    if (tocando) return;
    var modo = intensidadeAtual();
    tocando = true;
    chegadaEm = Date.now();

    /* Faixa e moldura so no modo completo. No discreto o aviso e o som
     * curto mais a escada de atencao; no silencioso, so a escada. */
    if (modo.banner) {
      atualizarBanner();
      if (elBanner) elBanner.hidden = false;
      if (elMoldura) elMoldura.hidden = false;
    }

    marcarAtencao(true);

    if (modo.som === "repetido") {
      tocarUmaVez();
      var tipo = somDaVez();
      intervaloSirene = setInterval(function () { tocarUmaVez(); }, tipo.intervaloMs);
      /* Trava de seguranca: uma sirene que ninguem silencia nao pode tocar
       * o plantao inteiro. Ao bater o limite ela faz uma parada COMPLETA,
       * que devolve `tocando` a false — senao o alarme travaria em silencio
       * para sempre depois da primeira vez. */
      timeoutLimite = setTimeout(silenciarComReengate, DURACAO_MAX_SOM_MS);
    } else if (modo.som === "curto") {
      tocarUmaVez();
      /* Um toque unico nao tem o que silenciar: o estado volta sozinho,
       * senao o proximo paciente nao dispararia nada (o guard `tocando`
       * do topo barraria). O reengate continua valendo, porque a fila
       * cheia sem ninguem atender ainda precisa insistir. */
      timeoutLimite = setTimeout(silenciarComReengate, 4000);
    } else {
      /* Silencioso: nada a tocar nem a esconder, mas o ciclo precisa se
       * fechar do mesmo jeito. */
      timeoutLimite = setTimeout(silenciarComReengate, 4000);
    }
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
    /* A janela fecha junto com o silenciar: ela existe para chamar de
     * volta, e quem silenciou ja voltou. */
    if (Atencao) Atencao.fecharJanelaDeAviso();
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
      if (quantosAguardando() > 0) dispararAlarme();
    }, REENGATE_MS);
  }

  function marcarAtencao(podeNotificar) {
    if (!Atencao) return;
    var n = quantosAguardando();
    if (n <= 0) {
      Atencao.limpar();
      Atencao.fecharJanelaDeAviso();
      return;
    }

    /* Terceiro canal, e o mais barulhento: a notificacao do sistema
     * aparece e some, a janela FICA na barra de tarefas ate alguem
     * fechar. So abre quando o medico esta FORA da aba — abrir uma
     * janela por cima de quem ja esta olhando o Meeds e so atrapalhar. */
    if (config.janela && podeNotificar && Atencao.ondeEstaOMedico() === "fora") {
      Atencao.abrirJanelaDeAviso({
        titulo: "Paciente na fila",
        corpo: textoDoMotivo(),
      });
    }

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
    /* Caminho visivel para os ajustes — sem ela, so clique direito ou
       shift+clique abrem o painel, e ninguem descobre isso sozinho. */
    "#mb-config {",
    "  position: fixed; right: 82px; bottom: 20px; z-index: 2147483000;",
    "  width: 40px; height: 40px; border-radius: 50%; border: none; cursor: pointer;",
    "  font-size: 17px; line-height: 1; color: #fff; font-family: system-ui, sans-serif;",
    "  background: rgba(15,23,42,.55); box-shadow: 0 4px 14px rgba(0,0,0,.22);",
    "}",
    "#mb-config:hover { background: rgba(15,23,42,.78); }",
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
    "#mb-painel label.mb-linha { display:flex; align-items:center; gap:8px; font-weight:600; color:#1e293b; margin:12px 0 4px; cursor:pointer; }",
    "#mb-painel label.mb-linha input { width:auto; margin:0; }",
    "#mb-painel label.mb-linha[hidden] { display:none; }",
    "#mb-painel .mb-dica { font-size:11px; color:#94a3b8; line-height:1.45; margin:2px 0 4px; }",
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
      /* Sino sozinho so cicla intensidade (clique) ou abre os ajustes por
       * um gesto escondido (botao direito / shift+clique) — sem um jeito
       * visivel, quem nao conhece o gesto acha que "clicar nao funciona".
       * A engrenagem e so isso: um caminho obvio para a mesma tela. */
      '<button type="button" id="mb-config" title="Configurar Alarme de fila">⚙️</button>' +
      '<div id="mb-painel" hidden>' +
      "  <h2>Alarme de fila</h2>" +
      '  <label for="mb-intensidade">Quanto ele deve incomodar</label>' +
      '  <select id="mb-intensidade">' +
      '    <option value="completo">🔔 Completo</option>' +
      '    <option value="discreto">🔉 Discreto</option>' +
      '    <option value="silencioso">🔕 Silencioso</option>' +
      "  </select>" +
      '  <div class="mb-dica" id="mb-intensidade-dica"></div>' +
      '  <label for="mb-som" id="mb-som-rotulo">Som</label><select id="mb-som"></select>' +
      '  <label for="mb-volume">Volume</label><input type="range" id="mb-volume" min="0" max="100" step="5" />' +
      '  <button type="button" class="acao" id="mb-testar">🔊 Testar som</button>' +
      '  <label class="mb-linha" id="mb-janela-linha" for="mb-janela" hidden>' +
      '    <input type="checkbox" id="mb-janela" /> Abrir uma janela de aviso' +
      "  </label>" +
      '  <div class="mb-dica" id="mb-janela-dica"></div>' +
      '  <div id="mb-estado"></div>' +
      '  <button type="button" class="acao" id="mb-liberar" hidden>Ativar avisos do sistema</button>' +
      "</div>";

    elMoldura = shadow.getElementById("mb-moldura");
    elBanner = shadow.getElementById("mb-banner");
    elBotao = shadow.getElementById("mb-botao");
    elPainel = shadow.getElementById("mb-painel");
    var elConfig = shadow.getElementById("mb-config");

    var sel = shadow.getElementById("mb-som");

    /* Como o botao de som do Waze: um toque cicla entre as intensidades,
     * em vez de so ligar e desligar. A engrenagem ao lado (elConfig,
     * abaixo) e o jeito visivel de chegar aos ajustes — direito/shift no
     * sino continuam funcionando, para quem ja usa assim. */
    elBotao.addEventListener("click", function (ev) {
      if (ev.shiftKey) return abrirPainel();
      /* Aproveita o gesto para destravar o audio: o navegador so deixa
       * tocar som depois de uma interacao do usuario. */
      contexto();
      var i = ORDEM_INTENSIDADE.indexOf(config.intensidade);
      config.intensidade = ORDEM_INTENSIDADE[(i + 1) % ORDEM_INTENSIDADE.length];
      if (config.intensidade === "silencioso" && tocando) silenciarAlarme();
      gravar();
      refletir();
    });
    elBotao.addEventListener("contextmenu", function (ev) {
      ev.preventDefault();
      abrirPainel();
    });
    elConfig.addEventListener("click", function (ev) {
      ev.stopPropagation();
      abrirPainel();
    });
    shadow.getElementById("mb-silenciar").addEventListener("click", silenciarComReengate);
    sel.addEventListener("change", function () {
      if (intensidadeAtual().som === "curto") config.somCurto = sel.value;
      else config.som = sel.value;
      gravar();
      /* Toca a amostra na hora. Antes era preciso escolher e depois
       * clicar em "Testar" — dois passos para responder "como e esse?",
       * que e a unica pergunta que existe ao mexer nessa lista. */
      contexto();
      tocarUmaVez(SONS[sel.value]);
    });

    shadow.getElementById("mb-intensidade").addEventListener("change", function (ev) {
      config.intensidade = ev.target.value;
      if (config.intensidade === "silencioso" && tocando) silenciarAlarme();
      gravar();
      refletir();
    });

    shadow.getElementById("mb-janela").addEventListener("change", function (ev) {
      config.janela = ev.target.checked;
      gravar();
      /* Abre uma de teste no ato: e a unica forma de o medico descobrir
       * AGORA que o navegador bloqueia pop-up, em vez de as 3 da manha
       * quando o aviso nao vier. */
      if (config.janela && Atencao) {
        Atencao.abrirJanelaDeAviso({
          titulo: "Janela de aviso ligada",
          corpo: "É assim que ela vai aparecer quando chegar paciente.",
        });
        setTimeout(function () { Atencao.fecharJanelaDeAviso(); }, 3000);
      }
      refletirJanela();
    });
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
    var modo = intensidadeAtual();
    elBotao.textContent = modo.icone;
    elBotao.className = config.intensidade === "silencioso" ? "desligado" : "ligado";
    elBotao.title =
      "Alarme: " + modo.rotulo + " — " + modo.resumo +
      " Clique para trocar de intensidade, ⚙️ ao lado para configurar.";

    if (shadow) {
      var curto = modo.som === "curto";
      preencherSons(curto);
      var sel = shadow.getElementById("mb-som");
      if (sel) sel.value = curto ? config.somCurto : config.som;
      var rotuloSom = shadow.getElementById("mb-som-rotulo");
      if (rotuloSom) {
        rotuloSom.textContent = curto ? "Som curto (modo discreto)" : "Som (modo completo)";
      }
      /* No silencioso nao toca som nenhum. Deixar a lista e o botao de
       * testar ativos ali seria oferecer um controle que nao faz nada —
       * o medico mexe, nao ouve, e conclui que o alarme quebrou. */
      var mudo = modo.som === false;
      var testar = shadow.getElementById("mb-testar");
      if (sel) sel.disabled = mudo;
      if (testar) testar.disabled = mudo;
      if (rotuloSom) rotuloSom.style.opacity = mudo ? ".45" : "";
      shadow.getElementById("mb-volume").value = config.volume;
      var dica = shadow.getElementById("mb-intensidade-dica");
      if (dica) dica.textContent = modo.resumo;
      var selInt = shadow.getElementById("mb-intensidade");
      if (selInt) selInt.value = config.intensidade;
      refletirJanela();
    }
  }

  /* A lista de sons muda com a intensidade: no discreto so aparecem os
   * curtos, no completo so os que repetem. Mostrar os onze sempre faria
   * o medico escolher uma sirene para o modo que toca uma vez so — e ela
   * sairia truncada, sem ele entender por que. */
  function preencherSons(curto) {
    var sel = shadow.getElementById("mb-som");
    if (!sel) return;
    var querido = curto ? config.somCurto : config.som;
    if (sel.getAttribute("data-curto") === String(curto)) return; // ja esta certa
    sel.setAttribute("data-curto", String(curto));
    sel.innerHTML = "";
    Object.keys(SONS)
      .filter(function (id) { return !!SONS[id].curto === curto; })
      .forEach(function (id) {
        var o = document.createElement("option");
        o.value = id;
        o.textContent = SONS[id].nome;
        sel.appendChild(o);
      });
    sel.value = querido;
  }

  /* A janela de aviso depende de coisas que a tela precisa dizer: no
   * iPad ela nao existe, e no Chrome pode ter sido bloqueada. Uma chave
   * que nao explica por que nao funcionou vira desconfianca no resto. */
  function refletirJanela() {
    var linha = shadow.getElementById("mb-janela-linha");
    var chave = shadow.getElementById("mb-janela");
    var dica = shadow.getElementById("mb-janela-dica");
    if (!linha || !chave || !Atencao) return;

    if (!Atencao.suportaJanela()) {
      /* No iPad nao ha janela: o iOS abre uma ABA por cima do Meeds, e
       * so a partir de um gesto. Oferecer a opcao ali seria oferecer algo
       * que nao acontece — e a instrucao de desbloquear pop-up fala de um
       * icone na barra de enderecos que o iPad nao tem. */
      linha.hidden = true;
      return;
    }
    linha.hidden = false;
    chave.checked = !!config.janela;
    if (dica) {
      dica.textContent = Atencao.janelaBloqueada()
        ? "O navegador bloqueou a janela. Procure o ícone de pop-up bloqueado na barra de endereço e permita para este site."
        : "Abre uma janelinha que fica na barra de tarefas até você fechar. Só aparece quando você está fora da aba do Meeds.";
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
          // silencioso = alarme mudo de proposito: avisar que ele "nao
          // tocou" enquanto suspenso seria alarme falso sobre um alarme
          // que o medico ja escolheu nao ouvir
          if (config.intensidade === "silencioso") return;
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
      return { tocando: tocando, aguardando: quantosAguardando(), intensidade: config && config.intensidade };
    },
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
