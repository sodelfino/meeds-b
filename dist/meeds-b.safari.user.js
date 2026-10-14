// ==UserScript==
// @name         Meeds B — Alarme de fila para iPad - por Marcelo
// @namespace    novetech-meeds-b-safari
// @version      1.5.0
// @description  Avisa quando entra paciente na fila do Pronto Atendimento do Meeds Doctor, mesmo com a aba de fundo ou o navegador minimizado. So o nome do paciente nunca e lido nem gravado.
// @author       Marcelo
// @match        https://doctor.calltechsaude.com.br/*
// @grant        none
// @inject-into auto
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.meta.js
// @downloadURL  https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.user.js
// ==/UserScript==

/* ===== src/atencao.js ===== */
/* ------------------------------------------------------------------
 * src/atencao.js — para onde mandar um aviso, e por onde
 * ------------------------------------------------------------------
 * PARA QUE SERVE
 * Um aviso so serve se chegar onde o medico esta olhando. Um alarme que so
 * existe DENTRO da aba nao chega a quem esta no Memed, no prontuario ou
 * em outra janela — que e justamente quando ele mais importa.
 *
 * Este arquivo veio do Assistente Meeds (sodelfino/meeds-suite,
 * core/atencao.js) e e a unica coisa compartilhada entre os dois. Ele e
 * generico de proposito: nao sabe o que e fila nem o que e paciente.
 *
 * Este arquivo nao decide QUANDO avisar (isso e do modulo). Ele decide
 * POR ONDE, e oferece os canais que funcionam fora da aba:
 *   - contador no titulo   ("(3) Meeds", como Gmail e Slack)
 *   - contador no favicone (desenhado no canvas, visivel na aba)
 *   - notificacao do sistema (aparece com o navegador minimizado, e
 *     CLICAVEL: traz a aba para frente)
 *
 * POR QUE NAO "PISCAR MAIS FORTE"
 * Duas razoes, e nenhuma e estetica:
 *   1. A WCAG 2.3.1 limita qualquer coisa a menos de tres flashes por
 *      segundo, por risco de crise fotossensivel. As animacoes daqui
 *      ficam perto de 1 Hz e somem inteiras com prefers-reduced-motion.
 *   2. Fadiga de alarme. Alarme demais faz o profissional ignorar o
 *      alarme — inclusive o que importava. A saida do setor nao foi
 *      volume, foi ESCADA: cada degrau muda de canal, e so escala se
 *      ninguem reagiu.
 *
 * PRIVACIDADE: nenhum texto de aviso deve conter dado de paciente. Quem
 * chama passa contagem e tempo de espera — nunca nome, nunca CPF. Uma
 * notificacao do sistema aparece na tela de bloqueio e no historico de
 * notificacoes do computador, fora do navegador e fora do nosso
 * controle: e o pior lugar possivel para um dado de paciente.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var doc = typeof document !== "undefined" ? document : null;

  /* ------------------------------------------------------------------
   * ONDE ESTA A ATENCAO DO MEDICO
   * ------------------------------------------------------------------
   * "aqui" = aba visivel E janela em foco. Qualquer outra combinacao e
   * "fora": aba de fundo, outra janela, outro app, tela bloqueada.
   * Nao ha meio-termo confiavel — "visivel mas sem foco" e uma janela
   * atras de outra, que na pratica e fora.
   * ------------------------------------------------------------------ */
  function ondeEstaOMedico() {
    if (!doc) return "fora";
    if (doc.visibilityState === "hidden") return "fora";
    if (typeof doc.hasFocus === "function" && !doc.hasFocus()) return "fora";
    return "aqui";
  }

  function aoMudarAtencao(fn) {
    if (!doc || typeof fn !== "function") return function () {};
    var mao = function () { fn(ondeEstaOMedico()); };
    doc.addEventListener("visibilitychange", mao);
    raiz.addEventListener("focus", mao);
    raiz.addEventListener("blur", mao);
    return function cancelar() {
      doc.removeEventListener("visibilitychange", mao);
      raiz.removeEventListener("focus", mao);
      raiz.removeEventListener("blur", mao);
    };
  }

  /* ------------------------------------------------------------------
   * CONTADOR NO TITULO DA ABA
   * ------------------------------------------------------------------
   * Substitui o titulo piscando. Piscar disputa atencao a cada segundo e
   * some quando o medico olha; "(3)" fica parado, e some sozinho quando
   * a fila esvazia. O reaplicador existe porque o Meeds e uma SPA e
   * reescreve o titulo ao navegar — sem ele, o contador sumiria na
   * primeira troca de tela.
   * ------------------------------------------------------------------ */
  var PREFIXO_RX = /^\((\d+)\)\s+/;
  var tituloLimpo = null;
  var contagemNoTitulo = 0;
  var reaplicador = null;

  function semPrefixo(texto) {
    return String(texto || "").replace(PREFIXO_RX, "");
  }

  function aplicarTitulo() {
    if (!doc) return;
    var desejado = contagemNoTitulo > 0 ? "(" + contagemNoTitulo + ") " + tituloLimpo : tituloLimpo;
    if (doc.title !== desejado) doc.title = desejado;
  }

  function marcarTitulo(contagem) {
    if (!doc) return;
    if (tituloLimpo === null) tituloLimpo = semPrefixo(doc.title);
    /* Se a SPA trocou o titulo por conta propria, o novo titulo e que
     * vale — so tiramos o nosso prefixo antes de guardar. */
    var atualSemPrefixo = semPrefixo(doc.title);
    if (atualSemPrefixo && atualSemPrefixo !== tituloLimpo) tituloLimpo = atualSemPrefixo;

    contagemNoTitulo = contagem > 0 ? contagem : 0;
    aplicarTitulo();

    if (contagemNoTitulo > 0 && !reaplicador) {
      reaplicador = setInterval(aplicarTitulo, 2000);
    } else if (contagemNoTitulo === 0 && reaplicador) {
      clearInterval(reaplicador);
      reaplicador = null;
    }
  }

  function limparTitulo() {
    marcarTitulo(0);
  }

  /* ------------------------------------------------------------------
   * CONTADOR NO FAVICONE
   * ------------------------------------------------------------------
   * Desenhado no canvas. A aba do Meeds costuma estar de fundo, e o
   * favicone e a unica parte dela que continua visivel na barra de abas.
   * ------------------------------------------------------------------ */
  var faviconeOriginal = null;
  var linkFavicone = null;

  function acharOuCriarLinkFavicone() {
    if (!doc) return null;
    var link = doc.querySelector('link[rel~="icon"]');
    if (!link) {
      link = doc.createElement("link");
      link.rel = "icon";
      (doc.head || doc.documentElement).appendChild(link);
    }
    return link;
  }

  function desenharFavicone(contagem) {
    try {
      var lado = 64;
      var canvas = doc.createElement("canvas");
      canvas.width = lado;
      canvas.height = lado;
      var ctx = canvas.getContext("2d");
      if (!ctx) return null;

      /* Fundo neutro: nao tentamos redesenhar o favicone do Meeds por
       * cima porque carregar a imagem original e assincrono e pode
       * falhar (origem cruzada, cache). Um quadrado solido com o numero
       * cumpre o papel e nunca falha pela metade. */
      ctx.fillStyle = "#0f172a";
      ctx.beginPath();
      if (ctx.roundRect) ctx.roundRect(0, 0, lado, lado, 14);
      else ctx.rect(0, 0, lado, lado);
      ctx.fill();

      ctx.fillStyle = "#dc2626";
      ctx.beginPath();
      ctx.arc(lado / 2, lado / 2, lado / 2 - 4, 0, Math.PI * 2);
      ctx.fill();

      var texto = contagem > 99 ? "99+" : String(contagem);
      ctx.fillStyle = "#ffffff";
      ctx.font = "bold " + (texto.length > 2 ? 26 : 38) + "px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(texto, lado / 2, lado / 2 + 2);

      return canvas.toDataURL("image/png");
    } catch (e) {
      return null;
    }
  }

  function marcarFavicone(contagem) {
    if (!doc) return;
    try {
      linkFavicone = linkFavicone || acharOuCriarLinkFavicone();
      if (!linkFavicone) return;
      if (faviconeOriginal === null) faviconeOriginal = linkFavicone.getAttribute("href") || "";
      var url = desenharFavicone(contagem);
      if (url) linkFavicone.setAttribute("href", url);
    } catch (e) {
      /* silencioso: favicone e reforco, nunca pode quebrar a pagina */
    }
  }

  function limparFavicone() {
    if (!linkFavicone || faviconeOriginal === null) return;
    try {
      if (faviconeOriginal) linkFavicone.setAttribute("href", faviconeOriginal);
      else linkFavicone.removeAttribute("href");
    } catch (e) {
      /* silencioso */
    }
  }

  /* ------------------------------------------------------------------
   * NOTIFICACAO DO SISTEMA
   * ------------------------------------------------------------------
   * O unico canal que atravessa o navegador. Duas regras:
   *   - permissao SO se pede a partir de um clique do medico (navegador
   *     ignora, e alguns punem, pedido sem gesto do usuario);
   *   - sempre com `tag`: uma notificacao SUBSTITUI a anterior em vez de
   *     empilhar. Vinte avisos parados no canto da tela sao a definicao
   *     de fadiga de alarme.
   * No Safari do iPad isto nao existe fora de app instalado — por isso
   * cada funcao degrada em silencio, e o alarme na tela continua sendo o
   * canal principal.
   * ------------------------------------------------------------------ */
  var TAG_PADRAO = "meeds-b";

  function suportaNotificacao() {
    return typeof raiz.Notification === "function";
  }

  function permissaoDeNotificacao() {
    if (!suportaNotificacao()) return "indisponivel";
    return raiz.Notification.permission;
  }

  function pedirPermissaoDeNotificacao() {
    if (!suportaNotificacao()) return Promise.resolve(false);
    if (raiz.Notification.permission === "granted") return Promise.resolve(true);
    if (raiz.Notification.permission === "denied") return Promise.resolve(false);
    try {
      var r = raiz.Notification.requestPermission();
      /* Safari antigo usa callback em vez de promessa. */
      if (r && typeof r.then === "function") {
        return r.then(function (p) { return p === "granted"; }).catch(function () { return false; });
      }
      return new Promise(function (ok) {
        raiz.Notification.requestPermission(function (p) { ok(p === "granted"); });
      });
    } catch (e) {
      return Promise.resolve(false);
    }
  }

  function notificar(opcoes) {
    var o = opcoes || {};
    if (permissaoDeNotificacao() !== "granted") return null;
    try {
      var n = new raiz.Notification(o.titulo || "Assistente Meeds", {
        body: o.corpo || "",
        tag: o.tag || TAG_PADRAO,
        renotify: true,
        requireInteraction: !!o.exigeInteracao,
        silent: true, // o som e do modulo, com o tipo e volume que o medico escolheu
      });
      n.onclick = function () {
        try { raiz.focus(); } catch (e) {}
        try { n.close(); } catch (e) {}
        if (typeof o.aoClicar === "function") o.aoClicar();
      };
      return n;
    } catch (e) {
      return null;
    }
  }

  /* ------------------------------------------------------------------
   * MANTER A TELA ACESA (Wake Lock)
   * ------------------------------------------------------------------
   * Para o plantao no iPad: alarme que toca com a tela apagada e alarme
   * perdido. O bloqueio cai sozinho quando a aba vai para o fundo, entao
   * ele e reconquistado quando ela volta.
   * ------------------------------------------------------------------ */
  var travaTela = null;
  var querTelaAcesa = false;
  var vigiaTela = null;

  function suportaTelaAcesa() {
    return !!(raiz.navigator && raiz.navigator.wakeLock && raiz.navigator.wakeLock.request);
  }

  function conquistarTrava() {
    if (!querTelaAcesa || !suportaTelaAcesa() || travaTela) return Promise.resolve(false);
    if (doc && doc.visibilityState !== "visible") return Promise.resolve(false);
    return raiz.navigator.wakeLock
      .request("screen")
      .then(function (t) {
        travaTela = t;
        t.addEventListener("release", function () { travaTela = null; });
        return true;
      })
      .catch(function () { return false; });
  }

  function manterTelaAcesa(ligar) {
    querTelaAcesa = !!ligar;
    if (!querTelaAcesa) {
      if (vigiaTela) { doc.removeEventListener("visibilitychange", vigiaTela); vigiaTela = null; }
      if (travaTela) {
        try { travaTela.release(); } catch (e) {}
        travaTela = null;
      }
      return Promise.resolve(false);
    }
    if (doc && !vigiaTela) {
      vigiaTela = function () { if (doc.visibilityState === "visible") conquistarTrava(); };
      doc.addEventListener("visibilitychange", vigiaTela);
    }
    return conquistarTrava();
  }

  /* ------------------------------------------------------------------
   * A ABA FOI SUSPENSA?
   * ------------------------------------------------------------------
   * O Edge tem "guias em suspensao" LIGADO de fabrica, e o Chrome tem o
   * congelamento de guias de fundo. Uma aba suspensa para os timers: o
   * Meeds deixa de consultar a fila e o alarme simplesmente NAO TOCA —
   * sem erro, sem aviso, sem nada. Para um alarme de plantao esse e o
   * pior modo de falha possivel, porque e silencioso.
   *
   * Nao da para impedir pela pagina. Da para PERCEBER: um pulso de 30 s
   * que demorou muito mais que isso so pode ter sido congelado. O limite
   * de 3x cobre com folga o afunilamento normal de aba de fundo (que no
   * Chromium vai a um disparo por minuto) sem acusar falso positivo.
   * ------------------------------------------------------------------ */
  var INTERVALO_PULSO_MS = 30000;
  var TOLERANCIA_PULSO = 3;
  var ultimoPulso = 0;
  var pulso = null;
  var ouvintesSuspensao = [];

  function aoAcordarDeSuspensao(fn) {
    if (typeof fn !== "function") return function () {};
    ouvintesSuspensao.push(fn);
    if (!pulso) {
      ultimoPulso = Date.now();
      pulso = setInterval(function () {
        var agora = Date.now();
        var atraso = agora - ultimoPulso;
        ultimoPulso = agora;
        if (atraso <= INTERVALO_PULSO_MS * TOLERANCIA_PULSO) return;
        ouvintesSuspensao.forEach(function (o) {
          try { o(atraso); } catch (e) {}
        });
      }, INTERVALO_PULSO_MS);
    }
    return function cancelar() {
      ouvintesSuspensao = ouvintesSuspensao.filter(function (o) { return o !== fn; });
      if (!ouvintesSuspensao.length && pulso) {
        clearInterval(pulso);
        pulso = null;
      }
    };
  }

  /* ------------------------------------------------------------------
   * MARCAR / LIMPAR — os dois unicos que um modulo costuma chamar
   * ------------------------------------------------------------------ */
  function marcar(opcoes) {
    var o = opcoes || {};
    var contagem = parseInt(o.contagem, 10) || 0;
    marcarTitulo(contagem);
    if (contagem > 0) marcarFavicone(contagem);
    else limparFavicone();
    if (o.notificar && ondeEstaOMedico() === "fora") {
      return notificar({
        titulo: o.titulo,
        corpo: o.corpo,
        tag: o.tag,
        exigeInteracao: o.exigeInteracao,
        aoClicar: o.aoClicar,
      });
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * JANELA DE AVISO (pop-up do navegador)
   * ------------------------------------------------------------------
   * Terceiro canal, e o mais barulhento dos tres. A notificacao do
   * sistema aparece e some; a janela FICA na barra de tarefas ate alguem
   * fechar. Para quem trabalha com varias janelas abertas e perde a
   * notificacao no canto, e a diferenca entre ver e nao ver.
   *
   * DUAS RAZOES PARA ELA NAO SER PADRAO:
   *   1. o Chrome bloqueia pop-up nao pedido por clique, e este e
   *      disparado por chegada de paciente, nao por gesto do medico —
   *      so funciona depois que o site ganha a permissao de pop-up;
   *   2. uma janela que rouba o foco no meio de uma teleconsulta e pior
   *      que o problema que resolve.
   * Por isso ela e opcional, nasce desligada, e nunca chama focus().
   *
   * PRIVACIDADE: mesma regra da notificacao — quantidade e tempo, nunca
   * nome de paciente. A janela pode ficar aberta atras de outras e
   * aparecer em compartilhamento de tela.
   * ------------------------------------------------------------------ */
  var NOME_DA_JANELA = "meeds-aviso-fila";
  var janelaAviso = null;

  /* ------------------------------------------------------------------
   * iPad / iPhone: a janela nao existe, e nao adianta pedir permissao
   * ------------------------------------------------------------------
   * `raiz.open` EXISTE no Safari do iOS, entao testar por ele daria
   * "suportado" e a opcao apareceria ligavel. So que ali nao ha janela
   * nenhuma: o iOS abre uma ABA nova, em cima do Meeds, e so a partir de
   * um gesto do medico — este aviso e disparado por chegada de paciente.
   * Na pratica: ou nao acontece nada, ou o Meeds sai da frente sozinho.
   *
   * Pior que a funcao nao funcionar era o que a tela dizia antes: mandava
   * o medico "clicar no icone de pop-up bloqueado na barra de endereco",
   * que no iPad nao existe. Instrucao que nao pode ser seguida gasta o
   * plantao e ensina a desconfiar do resto do painel.
   *
   * iPadOS 13+ se identifica como Mac; o que separa os dois e ter mais de
   * um ponto de toque.
   * ------------------------------------------------------------------ */
  function ehIOS() {
    var ua = (raiz.navigator && raiz.navigator.userAgent) || "";
    if (/Windows|Android/.test(ua)) return false;
    var pareceApple = /iPad|iPhone|iPod|Macintosh/.test(ua);
    return pareceApple && ((raiz.navigator && raiz.navigator.maxTouchPoints) || 0) > 1;
  }

  function suportaJanela() {
    if (ehIOS()) return false;
    return typeof raiz.open === "function";
  }

  function janelaBloqueada() {
    /* Chrome devolve null quando bloqueia. Guardamos o resultado para a
     * tela poder dizer ao medico o que aconteceu, em vez de ele achar
     * que a opcao nao faz nada. */
    return janelaAviso === false;
  }

  function abrirJanelaDeAviso(opcoes) {
    var o = opcoes || {};
    if (!suportaJanela()) return null;
    var largura = 400, altura = 230;
    var esq = Math.max(0, (raiz.screen && raiz.screen.width ? raiz.screen.width - largura - 30 : 40));
    var topo = 60;

    var j;
    try {
      j = raiz.open(
        "",
        NOME_DA_JANELA,
        "width=" + largura + ",height=" + altura + ",left=" + esq + ",top=" + topo +
          ",menubar=no,toolbar=no,location=no,status=no,resizable=yes,scrollbars=no"
      );
    } catch (e) {
      j = null;
    }

    if (!j) { janelaAviso = false; return null; }
    janelaAviso = j;

    try {
      j.document.open();
      j.document.write(
        "<!doctype html><html lang='pt-BR'><head><meta charset='utf-8'>" +
          "<title>" + escapar(o.titulo || "Paciente na fila") + "</title>" +
          "<style>" +
          "html,body{margin:0;height:100%;font:16px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;}" +
          "body{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;" +
          "background:linear-gradient(135deg,#dc2626,#b91c1c);color:#fff;text-align:center;padding:20px;}" +
          "h1{margin:0;font-size:20px;}p{margin:0;font-size:15px;opacity:.95;}" +
          "small{opacity:.8;font-size:12px;}" +
          "</style></head><body>" +
          "<h1>" + escapar(o.titulo || "Paciente na fila") + "</h1>" +
          "<p>" + escapar(o.corpo || "") + "</p>" +
          "<small>Volte ao Meeds para atender. Esta janela pode ser fechada.</small>" +
          "</body></html>"
      );
      j.document.close();
    } catch (e) {
      /* silencioso: a janela abriu, so nao deu para escrever nela */
    }
    return j;
  }

  function escapar(txt) {
    return String(txt || "").replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fecharJanelaDeAviso() {
    try {
      if (janelaAviso && janelaAviso !== false && !janelaAviso.closed) janelaAviso.close();
    } catch (e) {
      /* silencioso */
    }
    if (janelaAviso !== false) janelaAviso = null;
  }

  function limpar() {
    limparTitulo();
    limparFavicone();
  }

  raiz.MeedsBAtencao = {
    ondeEstaOMedico: ondeEstaOMedico,
    aoMudarAtencao: aoMudarAtencao,
    aoAcordarDeSuspensao: aoAcordarDeSuspensao,
    marcar: marcar,
    limpar: limpar,
    notificar: notificar,
    suportaNotificacao: suportaNotificacao,
    permissaoDeNotificacao: permissaoDeNotificacao,
    pedirPermissaoDeNotificacao: pedirPermissaoDeNotificacao,
    suportaTelaAcesa: suportaTelaAcesa,
    manterTelaAcesa: manterTelaAcesa,
    suportaJanela: suportaJanela,
    janelaBloqueada: janelaBloqueada,
    ehIOS: ehIOS,
    abrirJanelaDeAviso: abrirJanelaDeAviso,
    fecharJanelaDeAviso: fecharJanelaDeAviso,
    /* expostos para teste */
    _marcarTitulo: marcarTitulo,
    _limparTitulo: limparTitulo,
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);


/* ===== src/som.js ===== */
/* ------------------------------------------------------------------
 * src/som.js — a biblioteca de sons do alarme
 * ------------------------------------------------------------------
 * Sintetizados por osciladores (Web Audio), sem arquivo externo: o
 * alarme precisa tocar mesmo com a rede da unidade ruim, e um mp3 que
 * nao baixou e um alarme mudo. Vem do Assistente Meeds
 * (sodelfino/meeds-suite), onde ja rodou plantao de verdade.
 *
 * SAO DUAS LISTAS, E O CAMPO `curto` E QUEM AS SEPARA
 * As sirenes foram feitas para REPETIR: tocadas uma vez so, soam
 * truncadas — comecam e param no meio da ideia. Os sons `curto: true`
 * tem comeco, meio e fim em menos de um segundo e terminam decaindo em
 * vez de cortar. O modo discreto usa os curtos; o completo, os que
 * repetem. `tests/som.test.js` cobra o campo de todo som novo.
 *
 * Todos sobem o ganho a partir de ZERO em alguns milissegundos e descem
 * quase a zero antes de parar o oscilador. Sem essa rampa o navegador
 * produz um estalo no inicio e no fim — audivel, feio, e pior ainda num
 * fone de plantao noturno.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var TIPOS_DE_SOM = {
    "sirene-classica": {
      nome: "Sirene clássica (2 notas)",
      curto: false,
      intervaloMs: 1100,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(880, agora);
        osc.frequency.linearRampToValueAtTime(1320, agora + 0.35);
        osc.frequency.linearRampToValueAtTime(880, agora + 0.7);
        gain.gain.setValueAtTime(0, agora);
        gain.gain.linearRampToValueAtTime(0.35 * volume, agora + 0.05);
        gain.gain.linearRampToValueAtTime(0.35 * volume, agora + 0.65);
        gain.gain.linearRampToValueAtTime(0, agora + 0.75);
        osc.connect(gain).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 0.8);
      },
    },
    "sirene-ambulancia": {
      nome: "Sirene rápida (estilo ambulância)",
      curto: false,
      intervaloMs: 1050,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var gain = ctx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(700, agora);
        osc.frequency.setValueAtTime(950, agora + 0.25);
        osc.frequency.setValueAtTime(700, agora + 0.5);
        osc.frequency.setValueAtTime(950, agora + 0.75);
        gain.gain.setValueAtTime(0.3 * volume, agora);
        gain.gain.setValueAtTime(0, agora + 0.98);
        osc.connect(gain).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 1.0);
      },
    },
    "alarme-incendio": {
      nome: "Alarme (bipes curtos repetidos)",
      curto: false,
      intervaloMs: 700,
      tocar: function (ctx, volume) {
        var base = ctx.currentTime;
        for (var i = 0; i < 3; i++) {
          var inicio = base + i * 0.2;
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(1200, inicio);
          gain.gain.setValueAtTime(0.3 * volume, inicio);
          gain.gain.setValueAtTime(0, inicio + 0.12);
          osc.connect(gain).connect(ctx.destination);
          osc.start(inicio);
          osc.stop(inicio + 0.13);
        }
      },
    },
    campainha: {
      nome: "Campainha (mais suave)",
      curto: false,
      intervaloMs: 2000,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        [
          { freq: 900, inicio: 0, duracao: 0.3 },
          { freq: 700, inicio: 0.3, duracao: 0.4 },
        ].forEach(function (n) {
          var osc = ctx.createOscillator();
          var gain = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(n.freq, agora + n.inicio);
          gain.gain.setValueAtTime(0, agora + n.inicio);
          gain.gain.linearRampToValueAtTime(0.3 * volume, agora + n.inicio + 0.03);
          gain.gain.exponentialRampToValueAtTime(0.001, agora + n.inicio + n.duracao);
          osc.connect(gain).connect(ctx.destination);
          osc.start(agora + n.inicio);
          osc.stop(agora + n.inicio + n.duracao + 0.05);
        });
      },
    },
  
    /* ----------------------------------------------------------------
     * SONS DE TOQUE UNICO (modo discreto)
     * ----------------------------------------------------------------
     * As quatro sirenes acima foram feitas para REPETIR: tocadas uma vez
     * so, soam truncadas — comecam e param no meio da ideia. Estas tem
     * comeco, meio e fim em menos de um segundo, e terminam decaindo em
     * vez de cortar.
     *
     * Todas sobem o ganho a partir de ZERO em alguns milissegundos e
     * descem quase a zero antes de parar o oscilador. Sem essa rampa o
     * navegador produz um estalo no inicio e no fim — audivel, feio, e
     * pior ainda num fone de plantao noturno.
     * ---------------------------------------------------------------- */
    "toque-duplo": {
      nome: "Toque duplo (dois tons)",
      curto: true,
      intervaloMs: 1200,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        [{ f: 880, t: 0 }, { f: 1174.7, t: 0.13 }].forEach(function (n) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(n.f, agora + n.t);
          g.gain.setValueAtTime(0.0001, agora + n.t);
          g.gain.linearRampToValueAtTime(0.32 * volume, agora + n.t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0008, agora + n.t + 0.34);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + n.t);
          osc.stop(agora + n.t + 0.36);
        });
      },
    },
    "sino-curto": {
      nome: "Sino curto",
      curto: true,
      intervaloMs: 1400,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Um sino e a fundamental MAIS um parcial agudo que morre antes
         * dela — e o que separa "sino" de "bipe". */
        [{ f: 1568, v: 0.3, d: 0.9 }, { f: 2350, v: 0.12, d: 0.35 }].forEach(function (n) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(n.f, agora);
          g.gain.setValueAtTime(0.0001, agora);
          g.gain.linearRampToValueAtTime(n.v * volume, agora + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0006, agora + n.d);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora);
          osc.stop(agora + n.d + 0.02);
        });
      },
    },
    "gota": {
      nome: "Gota (bem discreto)",
      curto: true,
      intervaloMs: 900,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1250, agora);
        osc.frequency.exponentialRampToValueAtTime(620, agora + 0.14);
        g.gain.setValueAtTime(0.0001, agora);
        g.gain.linearRampToValueAtTime(0.3 * volume, agora + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0007, agora + 0.28);
        osc.connect(g).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 0.3);
      },
    },
    "acorde-suave": {
      nome: "Acorde suave (três notas)",
      curto: true,
      intervaloMs: 1600,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach(function (f, i) {
          var t = i * 0.075;
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(f, agora + t);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.22 * volume, agora + t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0006, agora + t + 0.55);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.58);
        });
      },
    },
    "dois-cliques": {
      nome: "Dois cliques (quase mudo)",
      curto: true,
      intervaloMs: 800,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Para quem divide a sala com outro profissional e nao quer que o
         * alarme vire assunto da consulta ao lado. */
        [0, 0.09].forEach(function (t) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(2100, agora + t);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.12 * volume, agora + t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0005, agora + t + 0.035);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.04);
        });
      },
    },

    /* ----------------------------------------------------------------
     * MAIS DUAS PARA O MODO COMPLETO
     * ---------------------------------------------------------------- */
    "pulso-grave": {
      nome: "Pulso grave (plantão noturno)",
      curto: false,
      intervaloMs: 1300,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Grave atravessa parede e cansa menos que agudo. Pensado para a
         * madrugada, quando o estridente e justamente o que faz o medico
         * desligar o alarme — e perder o paciente seguinte. */
        [0, 0.42].forEach(function (t) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(196, agora + t);
          osc.frequency.linearRampToValueAtTime(233, agora + t + 0.3);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.42 * volume, agora + t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0008, agora + t + 0.34);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.36);
        });
      },
    },
    "sirene-lenta": {
      nome: "Sirene lenta (menos estridente)",
      curto: false,
      intervaloMs: 1500,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(560, agora);
        osc.frequency.linearRampToValueAtTime(760, agora + 0.55);
        osc.frequency.linearRampToValueAtTime(560, agora + 1.1);
        g.gain.setValueAtTime(0.0001, agora);
        g.gain.linearRampToValueAtTime(0.34 * volume, agora + 0.06);
        g.gain.setValueAtTime(0.34 * volume, agora + 1.0);
        g.gain.linearRampToValueAtTime(0.0001, agora + 1.12);
        osc.connect(g).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 1.15);
      },
    },
};

  raiz.MeedsBSom = TIPOS_DE_SOM;
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);


/* ===== src/fila.js ===== */
/* ------------------------------------------------------------------
 * src/fila.js — descobrir que chegou paciente no Meeds Doctor
 * ------------------------------------------------------------------
 * O QUE ESTE ARQUIVO SABE, E COMO SABE
 * A pergunta e uma so: "entrou alguem novo na fila?". Ela e respondida
 * por tres sinais independentes, porque um sozinho e fragil — o site
 * muda de layout, a API muda de formato, o poll atrasa.
 *
 *   A. TOAST DO PROPRIO APP  (sinal mais forte)
 *      O Meeds Doctor ja avisa sozinho: aparece um aviso no canto com
 *      "Novo paciente na fila". Isso e uma decisao que o PROPRIO
 *      servidor tomou — ele so mostra quando de fato chegou alguem.
 *      Melhor sinal possivel: nao precisamos re-deduzir nada.
 *
 *   B. CONTADOR "Aguardando"  (sinal de estado)
 *      O cartao no topo do Pronto Atendimento mostra quantos esperam.
 *      Serve para dois usos: saber SE ha fila (para parar o alarme
 *      quando esvazia) e QUANTOS (para o contador na aba).
 *
 *   C. RESPOSTA DE /api/doctor/queues/mine  (reforco)
 *      A tela consulta esse endereco sozinha. Nos so LEMOS a resposta
 *      que ja passou — nunca fazemos requisicao propria, nunca pedimos
 *      dado de outro profissional. O formato do corpo nao foi observado
 *      em nenhuma gravacao, entao a leitura aqui e deliberadamente
 *      generica: conta quantos objetos com "id" existem na resposta e
 *      nao presume nome de campo nenhum. Se o formato nao bater, este
 *      sinal simplesmente nao vota, e A e B seguem valendo.
 *
 * POR QUE O DOM VEM PRIMEIRO, AO CONTRARIO DO ASSISTENTE MEEDS
 * No Assistente Meeds a rede e o sinal principal porque o formato da
 * API era conhecido. Aqui o DOM veio primeiro: o corpo de /queues/mine so
 * foi observado em 17/09 (fila vazia) e em 14/10 (com um paciente). Desde
 * a segunda gravacao ele alimenta tambem a CONTAGEM — ver
 * contagemDaFila(). Desenhar em cima do que se observou, e nao do que se
 * imagina, e o que separa um alarme que funciona de um que so parece
 * funcionar.
 *
 * PRIVACIDADE: nada de paciente sai daqui. Os ids de atendimento vivem
 * em memoria e morrem com a aba; nenhum nome, CPF ou queixa e guardado,
 * registrado, exibido ou enviado. O aviso fala em quantidade e tempo,
 * nunca em gente — com uma unica excecao, deliberada: o modo Discreto
 * mostra a CIDADE do selo do paciente recem-chegado (ver
 * lerOrigemDoUltimoPaciente, mais abaixo), a mesma informacao e pela
 * mesma razao que o Assistente Meeds ja mostra la — sustenta uma decisao
 * real do medico (qual REMUME vale). O NOME continua fora.
 *
 * "NAO LIDO" SERIA PROMETER DEMAIS, e a revisao de 14/10 apontou isso:
 * varrer a tela atras de um rotulo ("Aguardando", "Novo") passa pelo
 * texto das folhas vizinhas, e o toast chega com o nome dentro do proprio
 * no. O que vale — e e o que este arquivo cumpre — e que esse texto so
 * e comparado com rotulos conhecidos, em memoria, na hora; nao e
 * atribuido a nenhuma variavel que sobreviva a funcao, nem registrado,
 * nem exibido, nem enviado. Os testes (tests/alarme-sinais.test.js)
 * procuram o nome em tudo que o medico pode ver e em tudo que vai a disco.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var doc = typeof document !== "undefined" ? document : null;

  /* Texto que o proprio app usa quando chega alguem. Fica aqui em cima,
   * sozinho, porque e a coisa mais provavel de mudar quando o Meeds
   * Doctor for atualizado — e a primeira que alguem vai querer corrigir. */
  var TEXTO_DO_TOAST = "novo paciente na fila";
  var ROTULO_AGUARDANDO = "aguardando";
  var ROTULO_ATENDER = "atender"; // o botao de cada linha de paciente na fila
  var CAMINHO_DA_FILA = "/api/doctor/queues/mine";
  /* Um toast e uma frase curta (na gravacao: frase + nome + fila, ~55
   * caracteres). Um no adicionado com mais texto que isto nao e o aviso:
   * e uma tela, uma lista, um painel que por acaso CONTEM a frase — e
   * ler o texto inteiro dele so para procurar uma frase e trabalho a mais
   * sobre conteudo que o alarme nao tem nada que olhar. */
  var LIMITE_TEXTO_DO_TOAST = 300;

  function normalizar(txt) {
    return String(txt || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  }

  /* ------------------------------------------------------------------
   * SINAL B — o contador "Aguardando"
   * ------------------------------------------------------------------
   * O cartao tem o rotulo "Aguardando" e, embaixo, o numero. Procuramos
   * o elemento-folha com o rotulo e descemos ate achar um numero puro no
   * mesmo cartao. Nao usamos classe de CSS: as classes desse app sao
   * utilitarias geradas (flex, px-5, shrink-0) e trocam a cada build.
   * ------------------------------------------------------------------ */
  function lerContadorAguardando() {
    if (!doc) return null;
    var folhas = doc.querySelectorAll("div, span, p, h1, h2, h3, h4, td, li");
    for (var i = 0; i < folhas.length; i++) {
      var el = folhas[i];
      if (el.children.length) continue;
      if (normalizar(el.textContent) !== ROTULO_AGUARDANDO) continue;

      /* Sobe no maximo quatro niveis procurando o cartao que contem o
       * numero. Quatro cobre a estrutura vista na gravacao com folga, e
       * evita subir ate o corpo da pagina e pegar um numero qualquer. */
      var caixa = el;
      for (var salto = 0; salto < 4 && caixa; salto++) {
        caixa = caixa.parentElement;
        if (!caixa) break;
        var n = primeiroNumeroSolto(caixa);
        if (n !== null) return n;
      }
    }
    return null;
  }

  function primeiroNumeroSolto(caixa) {
    var filhos = caixa.querySelectorAll("div, span, p, h1, h2, h3, h4");
    for (var i = 0; i < filhos.length; i++) {
      if (filhos[i].children.length) continue;
      var t = (filhos[i].textContent || "").trim();
      if (/^\d{1,3}$/.test(t)) return parseInt(t, 10);
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * SINAL D — a cidade de quem acabou de chegar (so para o modo Discreto)
   * ------------------------------------------------------------------
   * O Assistente Meeds (sodelfino/meeds-suite) ja passou por essa decisao:
   * ate a v2.33.1 ele lia o NOME do paciente e nunca chegou a mostra-lo; a
   * leitura foi removida porque dado que ninguem exibe ainda assim custa
   * (fica em memoria, aparece em depurador, em print de tela). O que
   * sustenta uma decisao real do medico ali e a cidade contratante — e e
   * so isso que o cartao do Discreto mostra la.
   *
   * Aqui a mesma regra, reforcada NA FORMA da leitura e, desde a revisao
   * de 14/10, na AMBIGUIDADE. O padrao exige uma palavra so, TODA
   * MINUSCULA (como a cidade aparece no selo, ex. "macae"): isso rejeita
   * o nome em Title Case e o de varias palavras — mas NAO rejeita um nome
   * de uma palavra so digitado em minusculas, nem um chip de prioridade
   * ("normal"). O padrao sozinho nao garante nada; o que garante e a
   * leitura FALHAR FECHADA:
   *   - mais de um candidato na mesma linha  -> null (nome ou chip + selo);
   *   - varias linhas "Novo" com cidades diferentes -> null (nao ha como
   *     saber qual e a mais recente pela tela);
   *   - nenhum candidato -> null.
   * O cartao, sem cidade, mostra so a contagem — nunca inventa.
   *
   * RISCO QUE SOBRA, dito sem rodeio: uma linha com UM unico candidato
   * minusculo que seja um nome (e nenhum selo) ainda seria lida como
   * cidade. Fechar isso de vez exige uma lista fechada de cidades ou o
   * tenantId do payload, que so chega na navegacao — e uma decisao de
   * produto, nao de leitura.
   * ------------------------------------------------------------------ */
  var PADRAO_SELO_CIDADE = /^\p{Ll}[\p{Ll}-]{1,29}$/u;

  function lerOrigemDoUltimoPaciente() {
    if (!doc) return null;
    var cidades = [];
    var folhas = doc.querySelectorAll("div, span, p, li, td");
    for (var i = 0; i < folhas.length; i++) {
      var el = folhas[i];
      if (el.children.length) continue;
      if (normalizar(el.textContent) !== "novo") continue; // selo do paciente recem-chegado

      var linha = el;
      for (var salto = 0; salto < 5 && linha; salto++) {
        linha = linha.parentElement;
        if (!linha) break;
        var candidatos = selosDeCidade(linha);
        if (!candidatos.length) continue;
        if (candidatos.length > 1) return null; // ambiguo na propria linha
        cidades.push(candidatos[0]);
        break;
      }
    }
    if (!cidades.length) return null;
    for (var k = 1; k < cidades.length; k++) {
      if (cidades[k] !== cidades[0]) return null; // linhas diferentes: nao adivinha
    }
    return cidades[0];
  }

  function selosDeCidade(caixa) {
    var achados = [];
    var filhos = caixa.querySelectorAll("div, span, p");
    for (var i = 0; i < filhos.length; i++) {
      if (filhos[i].children.length) continue;
      var t = (filhos[i].textContent || "").trim();
      if (PADRAO_SELO_CIDADE.test(t)) achados.push(t);
    }
    return achados;
  }

  /* ------------------------------------------------------------------
   * SINAL A — o toast do proprio app
   * ------------------------------------------------------------------
   * Um MutationObserver so, na raiz, olhando texto novo. Cada aviso e
   * contado UMA vez: o mesmo no permanece na tela por alguns segundos e
   * sofre varias mutacoes enquanto anima.
   * ------------------------------------------------------------------ */
  function observarToast(aoAparecer) {
    if (!doc || typeof MutationObserver !== "function") return function () {};
    var jaVistos = new Set();

    var obs = new MutationObserver(function (mutacoes) {
      for (var i = 0; i < mutacoes.length; i++) {
        var novos = mutacoes[i].addedNodes || [];
        for (var j = 0; j < novos.length; j++) {
          var no = novos[j];
          if (!no || no.nodeType !== 1) continue;
          var bruto = no.textContent || "";
          if (bruto.length > LIMITE_TEXTO_DO_TOAST) continue;
          var texto = normalizar(bruto);
          if (texto.indexOf(TEXTO_DO_TOAST) === -1) continue;
          if (jaVistos.has(no)) continue;
          jaVistos.add(no);
          /* O Set guarda o proprio no, entao ele e liberado quando o
           * app remove o toast da tela. Nao cresce sem fim. */
          try { aoAparecer(); } catch (e) {}
        }
      }
    });

    obs.observe(doc.documentElement || doc.body, { childList: true, subtree: true });
    return function parar() { obs.disconnect(); };
  }

  /* ------------------------------------------------------------------
   * SINAL C — a resposta de /queues/mine
   * ------------------------------------------------------------------
   * O corpo foi observado pela primeira vez em 17/09 (gravacao com a fila
   * vazia): um ARRAY de filas, cada uma
   *   { queue: { id, careLineId, careLine, careLineName, label, ... },
   *     status: "ok", items: [...pacientes...], stats: { waiting, ... } }
   * Esse formato tem um caso especial abaixo (objeto com "queue" + "items"):
   * so os ids de DENTRO de "items" contam. Sem ele, o proprio id da fila
   * (que nao tem nada aninhado com "id") viraria uma "folha" e seria
   * contado como paciente — sempre presente, entao nunca dispara um
   * alarme sozinho (o id da fila e estavel entre polls), MAS uma
   * reconfiguracao de fila (nova especialidade, novo careLineId) pareceria
   * "chegou paciente" com a fila comprovadamente vazia. Ver
   * tests/fila.test.js.
   *
   * Fora desse caso, a leitura continua GENERICA de proposito: contar
   * objetos com "id" funciona com lista solta, com lista dentro de "data",
   * com filas aninhadas de formato ainda nao visto — e devolve null (nao
   * vota) se nada bater. Um palpite errado sobre nome de campo daria um
   * alarme que nao toca, que e a pior falha possivel aqui.
   * ------------------------------------------------------------------ */
  function ehChamadaDaFila(url) {
    return String(url || "").indexOf(CAMINHO_DA_FILA) !== -1;
  }

  /* Colhe os ids das FOLHAS: objetos que tem "id" e que nao contem
   * nenhum outro objeto com "id" dentro. Isso importa mais do que
   * parece — o endereco se chama /queues/mine, entao o mais provavel e
   * que a resposta seja uma lista de FILAS, cada uma com pacientes
   * dentro. Contar o primeiro nivel devolveria "1 fila" onde ha tres
   * pacientes esperando, e o alarme nao dispararia no segundo e no
   * terceiro. Descer ate a folha acerta nos dois formatos. */
  function idsDeFolhas(json, profundidade, saida) {
    var nivel = profundidade || 0;
    var ids = saida || [];
    if (nivel > 6 || !json || typeof json !== "object") return ids;

    if (Array.isArray(json)) {
      for (var i = 0; i < json.length; i++) idsDeFolhas(json[i], nivel + 1, ids);
      return ids;
    }

    /* Formato real (ver a nota acima): "queue" e o descritor da fila, e
     * pode ter "id" proprio — mas quem importa aqui e SO "items". Sem este
     * atalho, json.queue.id seria contado como se fosse um paciente. */
    if (json.queue && typeof json.queue === "object" && Array.isArray(json.items)) {
      for (var j = 0; j < json.items.length; j++) {
        /* Cada item e UMA ENTRADA NA FILA. Quem a identifica e o
         * consultationId — o patient.id e a PESSOA, e a mesma pessoa que
         * sai e volta (ou e re-enfileirada) e uma chegada nova com o mesmo
         * patient.id. Sem chave reconhecida, cai na leitura generica. */
        var chave = chaveDoItem(json.items[j]);
        if (chave !== null) ids.push(chave);
        else idsDeFolhas(json.items[j], nivel + 1, ids);
      }
      return ids;
    }

    var antes = ids.length;
    var chaves = Object.keys(json);
    for (var k = 0; k < chaves.length; k++) {
      idsDeFolhas(json[chaves[k]], nivel + 1, ids);
    }
    /* So conta como folha se nenhum descendente ja tiver contado. */
    if (ids.length === antes && temIdProprio(json)) ids.push(String(json.id));
    return ids;
  }

  function temIdProprio(obj) {
    return typeof obj.id === "string" || typeof obj.id === "number";
  }

  function ehChave(v) {
    return (typeof v === "string" && v !== "") || typeof v === "number";
  }

  function chaveDoItem(item) {
    if (!item || typeof item !== "object") return null;
    if (ehChave(item.consultationId)) return String(item.consultationId);
    if (ehChave(item.id)) return String(item.id);
    if (item.patient && typeof item.patient === "object" && ehChave(item.patient.id)) {
      return String(item.patient.id);
    }
    return null;
  }

  /* ------------------------------------------------------------------
   * QUANTOS ESPERAM, segundo a rede — so no formato que foi OBSERVADO
   * ------------------------------------------------------------------
   * Ate a v1.3.0 a rede so dizia "chegou alguem": a contagem vinha do
   * DOM, e o DOM so existe na tela do Pronto Atendimento. Fora dela o
   * alarme ficava com o ultimo numero que viu — o que e a metade do
   * "paciente preso" (ver tests/alarme.test.js, C1).
   *
   * O formato real traz a contagem pronta: cada fila tem stats.waiting,
   * e na gravacao de 14/10 ela bateu com items.length e com o cartao
   * "Aguardando" da tela. Aqui a leitura e ESTRITA, de proposito, ao
   * contrario de idsDeFolhas: so devolve numero se TODA entrada da lista
   * for uma fila reconhecivel. Qualquer outra forma devolve null, e null
   * significa "nao sei" — nunca "zero". Contar por palpite num formato
   * nao visto e exatamente o que o README proibe.
   * ------------------------------------------------------------------ */
  function contagemDaFila(json) {
    if (!Array.isArray(json) || json.length === 0) return null;
    var total = 0;
    for (var i = 0; i < json.length; i++) {
      var f = json[i];
      if (!f || typeof f !== "object") return null;
      if (!f.queue || typeof f.queue !== "object" || !Array.isArray(f.items)) return null;
      var espera = f.stats && typeof f.stats === "object" ? f.stats.waiting : undefined;
      total += typeof espera === "number" && espera >= 0 ? espera : f.items.length;
    }
    return total;
  }

  raiz.MeedsBFila = {
    lerContadorAguardando: lerContadorAguardando,
    lerOrigemDoUltimoPaciente: lerOrigemDoUltimoPaciente,
    observarToast: observarToast,
    ehChamadaDaFila: ehChamadaDaFila,
    idsDeFolhas: idsDeFolhas,
    contagemDaFila: contagemDaFila,
    normalizar: normalizar,
    TEXTO_DO_TOAST: TEXTO_DO_TOAST,
    ROTULO_ATENDER: ROTULO_ATENDER,
    CAMINHO_DA_FILA: CAMINHO_DA_FILA,
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);


/* ===== src/alarme.js ===== */
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
 * PRIVACIDADE: o aviso fala em quantidade e tempo. A unica excecao e o
 * modo Discreto, que mostra a CIDADE (nunca o nome) de quem acabou de
 * chegar — ver a nota em src/fila.js, lerOrigemDoUltimoPaciente(). Em
 * disco vao so as preferencias do medico (ligado, som, volume); a cidade
 * lida para o cartao vive so na variavel `ultimaOrigem`, em memoria, e
 * morre com a aba.
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
   * PARIDADE COM O ASSISTENTE MEEDS (sodelfino/meeds-suite)
   * La o Discreto mostra um cartao no canto com a cidade de quem chegou, o
   * som curto toca DUAS vezes (uma vez so passa despercebida num plantao
   * barulhento) e volta a cada 2 min enquanto o paciente continuar
   * esperando. Isto aqui e a mesma experiencia, com a mesma cautela: o
   * cartao mostra so a CIDADE (o selo minusculo do paciente), nunca o
   * nome — ver lerOrigemDoUltimoPaciente() em src/fila.js e a nota de
   * Privacidade la em cima.
   * ------------------------------------------------------------------ */
  var INTENSIDADES = {
    silencioso: {
      rotulo: "Silencioso",
      icone: "🔕",
      resumo: "Só o contador na aba e no favicone. Nada de som nem de aviso na tela.",
      som: false, banner: false, cartao: false,
    },
    discreto: {
      rotulo: "Discreto",
      icone: "🔉",
      resumo: "Um cartão no canto com a cidade de quem chegou, e um som curto que toca duas vezes — e volta a cada 2 min se o paciente continuar esperando.",
      som: "curto", banner: false, cartao: true,
    },
    completo: {
      rotulo: "Completo",
      icone: "🔔",
      resumo: "Sirene repetindo, faixa no topo e moldura na tela até você silenciar.",
      som: "repetido", banner: true, cartao: false,
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
  var DURACAO_CARTAO_MS = 12000;   // quanto o cartao do Discreto fica na tela
  /* Discreto: se o paciente que disparou o alarme continuar na fila, o
   * cartao e as duas batidas voltam a cada 2 min — mais curto que o
   * reengate do Completo (5 min) porque o Discreto e pensado para lembrar
   * com frequencia, sem interromper. Ver agendarRepiqueDeEsperaDiscreto(). */
  var INTERVALO_REPIQUE_DISCRETO_MS = 2 * 60000;
  /* A MESMA chegada chega por caminhos que nao chegam juntos: o toast, o
   * contador (lido de 4 em 4 s) e, na navegacao, a rede. Dentro desta
   * janela, um sinal que nao traz NENHUM paciente alem dos que ja foram
   * avisados e a mesma chegada vista por outro caminho. Tem que ser maior
   * que o poll do DOM mais o atraso do toast — o DEBOUNCE_MS de 2,5 s nao
   * era, e o resultado dependia da fase do poll (tests/alarme.test.js, I3). */
  var JANELA_MESMA_CHEGADA_MS = 10000;

  var config = null;
  var shadow = null;
  var elBotao = null;
  var elBanner = null;
  var elMoldura = null;
  var elPainel = null;
  var elCartao = null;

  var audioCtx = null;
  var tocando = false;
  var intervaloSirene = null;
  var timeoutLimite = null;
  var timeoutReengate = null;
  var timeoutSomCurtoRepique = null;
  var timeoutRepiqueDiscreto = null;
  var timeoutCartao = null;
  var timers = [];
  var pararToast = null;
  var pararSuspensao = null;

  var idsVistos = null;           // null = ainda nao ha base
  var ultimoContador = null;
  var ultimoContadorEm = 0;       // quando ultimoContador foi lido pela ULTIMA vez
  var ultimoDisparo = 0;
  var chegadaEm = null;           // quando o alarme comecou a tocar
  var ultimaOrigem = null;        // cidade do ultimo paciente, so para o cartao Discreto

  /* O que o alarme SABE sobre a fila, e quando soube. O numero sozinho
   * nao basta: o contador "Aguardando" so existe na tela do Pronto
   * Atendimento, e fora dela o ultimo numero lido e so um palpite que
   * envelhece. Era isto que deixava a sirene voltando para um paciente que
   * o medico ja estava atendendo. */
  var alertados = 0;              // quantos pacientes ja foram avisados e ainda se acredita que esperam
  var picoAvisado = 0;            // o maior numero que o ULTIMO alarme anunciou (so vale dentro da janela)
  var chegadaConfirmadaPeloDom = false; // o contador da tela ja mostrava a chegada quando o alarme saiu?
  var baseAssentada = false;      // a primeira contagem (DOM ou rede) so assenta a base
  var chegadasSemRede = 0;        // chegadas avisadas por toast/contador desde a ultima resposta da rede
  var motivoAtual = "chegada";    // "chegada" ou "ainda-aguardando": o que o aviso diz de si mesmo

  /* 3x o intervalo de polling do DOM — mesmo raciocinio do Assistente
   * Meeds (LIMITE_FRESCOR_DOM_MS): da folga para um ciclo perdido sem
   * abrir mao de exigir leitura RECENTE. Ver evidenciaFrescaDoContador(). */
  var LIMITE_FRESCOR_CONTADOR_MS = INTERVALO_DOM_MS * 3;

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

  /* ------------------------------------------------------------------
   * VALOR CONGELADO NAO E O MESMO QUE VALOR ATUAL — SO IMPORTA PARA QUEM
   * RE-TOCA SOZINHO
   * ------------------------------------------------------------------
   * `ultimoContador` nunca expira: ele so e sobrescrito quando ha uma
   * leitura fresca do DOM (lerContadorEReagir, a cada 4s, SE o contador
   * "Aguardando" estiver na tela). Fora da tela do Pronto Atendimento —
   * o medico atendendo o paciente que acabou de chegar, por exemplo —
   * ele simplesmente para de ser atualizado e fica parado no ultimo
   * numero visto, por quanto tempo for.
   *
   * Isso nao e problema nenhum para o uso comum de quantosAguardando()
   * (contador da aba, decidir se silencia um alarme TOCANDO agora): um
   * numero congelado ainda e a melhor informacao disponivel no momento.
   *
   * O problema e silenciarComReengate() usar esse MESMO numero, 5
   * MINUTOS DEPOIS, para decidir se volta a tocar a sirene inteira. Se o
   * medico saiu da tela assim que silenciou, o numero congelado nunca
   * mais mudou — e o reengate toca de novo achando que ainda ha gente,
   * mesmo que o paciente ja tenha sido atendido por outra via havera
   * muito tempo. E a mesma classe de defeito do Assistente Meeds (D64,
   * "abstencao nao e prova de ainda cheia"): la o sinal expirava em 12s
   * porque um decisor com prazo de validade; aqui nao ha decisor nenhum
   * — o numero so fica parado, o que e pior, porque nunca vira "nao
   * sei" sozinho.
   *
   * Por isso o REENGATE (nao o uso comum de quantosAguardando) passa a
   * exigir leitura FRESCA antes de soar de novo. */
  function evidenciaFrescaDoContador() {
    return ultimoContadorEm > 0 && Date.now() - ultimoContadorEm <= LIMITE_FRESCOR_CONTADOR_MS;
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

  /* contagem: quantos a FONTE diz que ha, ou undefined/null quando ela so
   * sabe que "chegou alguem" (o toast). semJanela: a fonte provou, por
   * identidade, que ha um paciente que nenhum aviso anterior cobriu —
   * entao a janela de "mesma chegada" nao se aplica. */
  function sinalizarChegada(origem, contagem, semJanela) {
    var agora = Date.now();
    var desdeUltimo = agora - ultimoDisparo;
    if (desdeUltimo < DEBOUNCE_MS) return false; // toast + rede = um alarme

    var fresco = Fila.lerContadorAguardando();
    var sabido = contagem !== undefined && contagem !== null ? contagem : fresco;

    /* Mesma chegada, visto por outro caminho: dentro da janela e sem
     * nenhum paciente alem dos que ja foram avisados. "Ja avisados" inclui
     * o pico do ULTIMO alarme, e nao so `alertados`: se o toast chegou
     * antes de o contador renderizar, o poll leu 0 e zerou `alertados` —
     * e, quando o contador subiu para 1, a mesma chegada parecia nova. */
    if (!semJanela && desdeUltimo < JANELA_MESMA_CHEGADA_MS &&
        sabido !== null && sabido > 0 && sabido <= Math.max(alertados, picoAvisado)) {
      /* So descarta; NAO absorve a leitura em `alertados`. Absorver parecia
       * natural, mas engole o segundo paciente quando um sai e outro entra
       * em menos de 10 s: ele pareceria "ja avisado" e nunca tocaria. Sem
       * absorver, o contador continua "maior que os avisados" e o alarme
       * dele sai quando a janela expira — atrasado, mas sai. Entre chegar
       * 10 s tarde e nunca chegar, o primeiro e o erro barato. A mesma
       * chegada vista duas vezes, o caso que a absorcao pretendia cobrir,
       * ja e tratada acima: um 0 de renderizacao nao zera `alertados`. */
      return false;
    }

    ultimoDisparo = agora;
    chegadaConfirmadaPeloDom = origem === "contador-dom" || (fresco !== null && fresco > 0);
    if (origem !== "rede-queues-mine") chegadasSemRede++;
    console.debug("[Meeds B] chegada detectada por", origem);
    /* A cidade e lida NA HORA da chegada: e o unico momento em que se sabe
     * qual selo pertence a quem acabou de entrar. Um repique 2 min depois
     * so reusa este valor — nao le a tela de novo (ver agendarRepiqueDe-
     * EsperaDiscreto). Se nao achar, o cartao mostra so a contagem. */
    ultimaOrigem = Fila.lerOrigemDoUltimoPaciente();
    /* A contagem usada no texto e a leitura FRESCA do cartao (feita acima),
     * nao a do ultimo poll: quando quem disparou e o toast ou a rede, o
     * proximo poll do DOM (a cada 4 s) ainda nao rodou. Mesma ideia do
     * Assistente Meeds em atualizarDistintivo() — "le o cartao AGORA".
     *
     * Se ninguem sabe quantos sao (o cartao nao esta na tela e a fonte
     * nao diz), a chegada AINDA E uma chegada: pelo menos mais um do que os
     * ja avisados. Sem esse piso a contagem ficava em 0 e a escada inteira
     * — titulo, favicone, notificacao do sistema, lembrete — era pulada
     * justamente quando o medico estava em outra tela (C2). Na duvida,
     * errar para MAIS: contar um a menos deixa um paciente sem aviso. */
    var n = sabido !== null && sabido > 0
      ? sabido
      : Math.max(quantosAguardando(), alertados + 1, 1);
    ultimoContador = n;
    /* So uma LEITURA renova o frescor. Um piso estimado ("pelo menos 1")
     * nao e leitura — e a mesma regra da D64: abstencao nao e prova. */
    if (sabido !== null && sabido > 0) ultimoContadorEm = agora;
    alertados = Math.max(alertados, n);
    picoAvisado = n;
    dispararAlarme("chegada");
    return true;
  }

  /* motivo: "chegada" (padrao) ou "ainda-aguardando" (repique do Discreto:
   * o MESMO paciente de 2 min atras continua na fila, ninguem novo
   * chegou). So muda o TITULO do cartao — o resto do disparo e identico. */
  function dispararAlarme(motivo) {
    if (tocando) return;
    var modo = intensidadeAtual();
    tocando = true;
    chegadaEm = Date.now();
    motivoAtual = motivo || "chegada";

    /* Faixa e moldura so no modo completo. No discreto o aviso e o cartao
     * mais o som curto (duas vezes) mais a escada de atencao; no
     * silencioso, so a escada. */
    if (modo.banner) {
      atualizarBanner();
      if (elBanner) elBanner.hidden = false;
      if (elMoldura) elMoldura.hidden = false;
    }

    marcarAtencao(true);

    if (modo.cartao) mostrarCartaoDeChegada(motivo);

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
      /* Toca DUAS vezes, espacadas pelo intervalo natural do proprio som
       * (o mesmo intervaloMs que o modo completo usa para repetir a
       * sirene) — uma vez so passava despercebida num plantao barulhento. */
      var tipoCurto = somDaVez();
      tocarUmaVez(tipoCurto);
      timeoutSomCurtoRepique = setTimeout(function () {
        timeoutSomCurtoRepique = null;
        tocarUmaVez(tipoCurto);
      }, tipoCurto.intervaloMs);
      /* Nao ha o que silenciar num toque curto: o estado volta sozinho,
       * senao o proximo paciente nao dispararia nada (o guard `tocando`
       * do topo barraria). Mas isto e o FIM NATURAL do toque, nao o medico
       * reconhecendo o alarme — por isso NAO passa por silenciarAlarme():
       * ate a v1.4.0 passava, e ele cancelava o repique de 2 min que acabou
       * de ser agendado logo abaixo, 4 s depois (C3). Quem insiste no
       * Discreto e o repique. */
      timeoutLimite = setTimeout(fecharCicloCurto, 4000);
      agendarRepiqueDeEsperaDiscreto();
    } else {
      /* Silencioso: nada a tocar nem a esconder, mas o ciclo precisa se
       * fechar do mesmo jeito — e, como no Discreto, e o FIM NATURAL dele:
       * passar por silenciarAlarme() fechava a janela de aviso 4 s depois
       * de aberta, a que o README diz que "fica ate alguem fechar". */
      timeoutLimite = setTimeout(function () {
        fecharCicloCurto();
        armarReengate();
      }, 4000);
    }
  }

  /* ------------------------------------------------------------------
   * REPIQUE DE ESPERA — SO NO MODO DISCRETO
   * ------------------------------------------------------------------
   * UM SO TIMER, agendado a cada disparo do modo curto — nunca um por
   * paciente. Cada vez que dispara, agenda a PROXIMA checagem em 2 min; na
   * hora de checar, confere de novo se ainda ha alguem esperando E se a
   * intensidade continua Discreto. Se qualquer uma das duas nao for mais
   * verdade, para sozinho — sem precisar de um botao "silenciar" que o
   * Discreto nunca teve.
   *
   * DE PROPOSITO NAO HA LIMITE DE REPETICOES: um alarme que desiste
   * sozinho depois de N vezes pode deixar um paciente esperando sem
   * ninguem saber. A saida para quem quer parar de ouvir e trocar para
   * 🔕 Silencioso.
   * ------------------------------------------------------------------ */
  function agendarRepiqueDeEsperaDiscreto() {
    if (timeoutRepiqueDiscreto) return; // ja ha um repique agendado
    timeoutRepiqueDiscreto = setTimeout(function () {
      timeoutRepiqueDiscreto = null;
      if (quantosAguardando() <= 0) return;           // paciente ja saiu da fila
      if (config.intensidade !== "discreto") {        // medico trocou de modo:
        armarLembreteDeEspera();                      // o lembrete passa ao ritmo do novo modo
        return;
      }
      /* Mesma regra do reengate (D64): sem leitura FRESCA do contador, nao
       * toca as cegas — reagenda em silencio, no mesmo ritmo, e decide
       * quando o medico voltar a tela da fila. */
      if (!evidenciaFrescaDoContador()) {
        console.debug("[Meeds B] sem leitura fresca da fila — repique reagendado em silencio");
        timeoutRepiqueDiscreto = null;
        agendarRepiqueDeEsperaDiscreto();
        return;
      }
      console.debug("[Meeds B] paciente ainda esperando, repique do modo discreto");
      dispararAlarme("ainda-aguardando");
    }, INTERVALO_REPIQUE_DISCRETO_MS);
  }

  function pararSom() {
    if (intervaloSirene) { clearInterval(intervaloSirene); intervaloSirene = null; }
    if (timeoutLimite) { clearTimeout(timeoutLimite); timeoutLimite = null; }
    if (timeoutSomCurtoRepique) { clearTimeout(timeoutSomCurtoRepique); timeoutSomCurtoRepique = null; }
    /* O repique do Discreto NAO e som: e o lembrete. Esta funcao ja o
     * cancelou uma vez, por ter "parar" no nome, e matou o recurso que a
     * v1.4.0 trazia. Cancelar o lembrete e uma decisao — cancelarRepique(). */
  }

  function cancelarRepique() {
    if (timeoutRepiqueDiscreto) { clearTimeout(timeoutRepiqueDiscreto); timeoutRepiqueDiscreto = null; }
  }

  /* Fim natural do toque curto (Discreto). Nao e uma acao do medico: nao
   * esconde o cartao (ele tem a duracao dele), nao fecha a janela de aviso,
   * nao arma o lembrete de 5 min nem cancela o de 2. So devolve o estado. */
  function fecharCicloCurto() {
    pararSom();
    tocando = false;
    chegadaEm = null;
  }

  /* A fila esvaziou — medido na tela, na rede, ou pelo medico ao clicar em
   * Atender. Tudo que existia por haver "paciente esperando" perde o
   * motivo: som, faixa, cartao, lembrete e contagem na aba. */
  function aoFilaVazia() {
    alertados = 0;
    ultimoContador = 0;
    if (timeoutReengate) { clearTimeout(timeoutReengate); timeoutReengate = null; }
    cancelarRepique();
    if (tocando) silenciarAlarme();
    marcarAtencao(false); // com 0, limpa titulo, favicone e janela
  }

  /* Havia gente esperando quando o alarme ligou (aba recarregada, script
   * atualizado). Nao toca agora — norma 3 — mas tambem nao pode ficar sem
   * lembrete: sem nenhum timer, esse paciente esperaria para sempre se
   * ninguem novo chegasse. */
  function armarLembreteDeEspera() {
    if (tocando || timeoutReengate || timeoutRepiqueDiscreto) return;
    if (config.intensidade === "discreto") {
      agendarRepiqueDeEsperaDiscreto();
      return;
    }
    timeoutReengate = setTimeout(tentarReengatarAlarme, REENGATE_MS);
  }

  /* Toda contagem CONFIRMADA — cartao do DOM ou corpo da rede — passa por
   * aqui. O que o resto do alarme consome e o numero E o instante em que
   * ele foi visto. */
  function registrarLeitura(n) {
    ultimoContador = n;
    ultimoContadorEm = Date.now();
    if (!baseAssentada) {
      baseAssentada = true;
      alertados = n;                       // quem ja estava la nao e "chegada"
      if (n > 0) armarLembreteDeEspera();
    } else if (n < alertados) {
      alertados = n;                       // alguem saiu: o proximo a chegar conta
    }
    if (n === 0) aoFilaVazia();
  }

  /* "Atender" clicado na linha de um paciente da fila e o sinal mais forte
   * de que ele deixou de esperar — e chega ANTES de a tela mudar, quando o
   * contador ainda existe. So vale na tela da fila: na Agenda o mesmo
   * rotulo atende uma consulta MARCADA, que nao e quem esta na fila, e
   * contar esse clique tiraria um paciente real da memoria do alarme.
   * Se o rotulo mudar, isto simplesmente para de agir e o comportamento
   * volta ao anterior (a contagem so cai quando alguem a le). */
  function aoClicarNaPagina(ev) {
    try {
      var alvo = ev && ev.target;
      var botao = alvo && typeof alvo.closest === "function" ? alvo.closest("button") : null;
      if (!botao) return;
      var rotulo = Fila.normalizar(botao.textContent);
      if (rotulo !== Fila.ROTULO_ATENDER && rotulo.indexOf(Fila.ROTULO_ATENDER + " ") !== 0) return;
      if (Fila.lerContadorAguardando() === null) return; // nao e a tela da fila
      aoMedicoAtender();
    } catch (e) {
      /* silencioso: este sinal e reforco, nunca pode quebrar a pagina */
    }
  }

  function aoMedicoAtender() {
    var n = Math.max(0, quantosAguardando() - 1);
    ultimoContador = n;
    ultimoContadorEm = Date.now();
    alertados = Math.min(alertados, n);
    if (n === 0) {
      aoFilaVazia();
    } else {
      if (tocando) atualizarBanner();
      marcarAtencao(false);
    }
  }

  function silenciarAlarme() {
    if (timeoutReengate) { clearTimeout(timeoutReengate); timeoutReengate = null; }
    cancelarRepique(); // silenciar DE PROPOSITO tambem cala o lembrete
    pararSom();
    tocando = false;
    chegadaEm = null;
    if (elBanner) elBanner.hidden = true;
    if (elMoldura) elMoldura.hidden = true;
    esconderCartao();
    /* A janela fecha junto com o silenciar: ela existe para chamar de
     * volta, e quem silenciou ja voltou. */
    if (Atencao) Atencao.fecharJanelaDeAviso();
    /* O distintivo NAO some aqui: silenciar o som nao tira o paciente da
     * fila. Ele so some quando a fila esvazia. */
    marcarAtencao(false);
  }

  /* Volta em 5 min, se ainda houver quem esperar nessa hora. */
  function armarReengate() {
    if (timeoutReengate) { clearTimeout(timeoutReengate); timeoutReengate = null; }
    if (quantosAguardando() <= 0) return;
    timeoutReengate = setTimeout(tentarReengatarAlarme, REENGATE_MS);
  }

  /* "Estou indo" — nao e "ignorar". Se o medico nao atender de fato, o
   * alarme volta, que e o acknowledge do plantao de software. */
  function silenciarComReengate() {
    var haviaFila = quantosAguardando() > 0;
    silenciarAlarme();
    if (haviaFila) armarReengate();
  }

  /* Sem leitura fresca do contador (medico fora da tela da fila havera
   * mais de LIMITE_FRESCOR_CONTADOR_MS): nao toca as cegas em cima de um
   * numero que pode ter ficado parado ha minutos. Tambem nao desiste —
   * tenta de novo mais tarde, na MESMA cadencia, ate uma leitura fresca
   * aparecer (o medico volta a tela, ou so o proximo poll de 4s pega o
   * contador visivel de novo). A corrente so morre quando ha PROVA fresca
   * de fila vazia; ate la, ela so para de SOAR sem prova.
   *
   * Vale para TODO lembrete que soa sozinho: o reengate de 5 min, o lembrete
   * de quem ja esperava quando o alarme ligou, e (via
   * repiqueDeEsperaDiscreto) o repique de 2 min do Discreto. */
  function tentarReengatarAlarme() {
    timeoutReengate = null;
    if (!evidenciaFrescaDoContador()) {
      console.debug("[Meeds B] sem leitura fresca da fila apos silenciar — reagendando em silencio, sem tocar");
      timeoutReengate = setTimeout(tentarReengatarAlarme, REENGATE_MS);
      return;
    }
    if (quantosAguardando() > 0) dispararAlarme("ainda-aguardando");
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

  /* ------------------------------------------------------------------
   * O CARTAO DISCRETO
   * ------------------------------------------------------------------
   * Aparece no canto de baixo pra cima, diz a cidade e o motivo, e sai
   * sozinho. Nao bloqueia nada e nao repete som — e o meio-termo que
   * faltava entre "sirene" e "nao fico sabendo". Mesma experiencia do
   * Assistente Meeds (ver a nota de paridade la em cima).
   * ------------------------------------------------------------------ */
  function mostrarCartaoDeChegada(motivo) {
    if (!elCartao) return;
    var elTitulo = shadow.getElementById("mb-cartao-titulo");
    var elCorpo = shadow.getElementById("mb-cartao-corpo");
    if (!elTitulo || !elCorpo) return;

    elTitulo.textContent =
      motivo === "ainda-aguardando" ? "🔔 Paciente ainda aguardando" : "🔔 Novo paciente na fila";
    elCorpo.innerHTML = "";
    var linhas = [];
    if (ultimaOrigem) linhas.push(ultimaOrigem);
    linhas.push(textoDoMotivo());
    linhas.forEach(function (linha) {
      var p = document.createElement("div");
      p.textContent = linha;
      elCorpo.appendChild(p);
    });

    if (timeoutCartao) clearTimeout(timeoutCartao);
    elCartao.hidden = false;
    /* Forca reflow antes de aplicar a classe: sem isto o navegador as
     * vezes agrupa "hidden=false" e a troca de classe no mesmo frame, e a
     * animacao de subida some — o cartao so "aparece" sem deslizar. */
    void elCartao.offsetHeight;
    elCartao.classList.add("mb-cartao-visivel");
    timeoutCartao = setTimeout(esconderCartao, DURACAO_CARTAO_MS);
  }

  function esconderCartao() {
    if (timeoutCartao) { clearTimeout(timeoutCartao); timeoutCartao = null; }
    if (!elCartao) return;
    elCartao.classList.remove("mb-cartao-visivel");
    elCartao.hidden = true;
  }

  /* ---------------- sinais ---------------- */

  function lerContadorEReagir() {
    var n = Fila.lerContadorAguardando();
    /* Fora do Pronto Atendimento o cartao nao existe: nao ha o que dizer —
     * e tambem nada a DESdizer. O ultimo numero fica, e a IDADE dele
     * (ultimoContadorEm) e o que qualquer lembrete consulta antes de soar
     * (evidenciaFrescaDoContador). */
    if (n === null) return;

    /* Um "0" logo depois de uma chegada que o contador AINDA NAO mostrava
     * (o toast ou a rede chegaram antes de a tela renderizar) e atraso de
     * renderizacao, nao "a fila esvaziou". Tratar como esvaziou calava o
     * alarme da propria chegada com 1 s de vida e apagava o que ele acabara
     * de aprender. Passada a janela, um 0 que persiste e verdadeiro; e um 0
     * vindo da REDE nunca e adiado — ele e a resposta do servidor. */
    if (n === 0 && !chegadaConfirmadaPeloDom && (alertados > 0 || tocando) &&
        Date.now() - ultimoDisparo < JANELA_MESMA_CHEGADA_MS) {
      return;
    }

    var haviaBase = baseAssentada;
    registrarLeitura(n);
    /* Chegada = mais gente do que a que ja foi AVISADA, nao "o numero
     * subiu desde o poll anterior": a segunda definicao toca de novo para
     * quem o toast ja anunciou e o contador so renderizou depois. */
    if (haviaBase && n > alertados) sinalizarChegada("contador-dom", n);
    if (tocando) atualizarBanner();
    if (n > 0) marcarAtencao(false);
  }

  function aoResponderFila(json) {
    var ids;
    try {
      ids = Fila.idsDeFolhas(json);
    } catch (e) {
      return; // formato inesperado: os outros sinais cobrem
    }
    var total = null;
    try {
      total = Fila.contagemDaFila(json); // null = "nao sei", nunca "zero"
    } catch (e) {
      total = null;
    }

    var tinhaBase = idsVistos !== null;
    var atual = {};
    var novos = 0;
    for (var i = 0; i < ids.length; i++) {
      atual[ids[i]] = true;
      if (tinhaBase && !idsVistos[ids[i]]) novos++;
    }
    idsVistos = atual;

    /* Chegadas que o toast ou o contador JA avisaram desde a ultima
     * resposta. Sem este desconto, o clique no menu — que busca a fila e
     * traz o MESMO paciente que acabou de ser anunciado — o contava como
     * novo e tocava de novo, justamente quando o medico chegava para
     * atender (H4). So o que sobra e chegada que ninguem avisou. */
    var jaAvisadas = chegadasSemRede;
    chegadasSemRede = 0;

    /* A rede sabe QUANTOS, em qualquer tela. E a unica fonte que ve a fila
     * vazia quando o contador nao esta na tela (C1). */
    if (total !== null) {
      registrarLeitura(total);
      /* A primeira resposta tambem so assenta a base: se o DOM leu "0" de
       * um esqueleto antes de os dados chegarem, quem ja esperava nao pode
       * virar chegada so porque o numero subiu de 0 para N. */
      if (!tinhaBase && total > alertados) alertados = total;
    }

    if (tinhaBase && novos - jaAvisadas > 0) {
      sinalizarChegada("rede-queues-mine", total, true);
    }
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
              if (xhr.status !== 200) return;
              /* Com responseType "json" o responseText LANCA em vez de
               * devolver o texto, e o corpo ja vem como objeto em
               * `response`. Ler so responseText fazia este sinal morrer em
               * silencio num app que configure o XHR assim. */
              var corpo = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
              aoResponderFila(corpo);
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
    /* O cartao do Discreto: nasce fora da tela (embaixo) e sobe. Some do
       mesmo jeito, de baixo pra cima, sem precisar de um segundo bloco de
       keyframes — so a posicao final muda com a classe. */
    "#mb-cartao {",
    "  position: fixed; right: 20px; bottom: 84px; z-index: 2147483001; width: 280px;",
    "  background: #16221f; color: #fff; border-radius: 12px; padding: 12px 14px;",
    "  box-shadow: 0 14px 40px rgba(0,0,0,.35); font: 400 12.5px system-ui, sans-serif;",
    "  transform: translateY(16px); opacity: 0; pointer-events: none;",
    "  transition: transform .22s ease, opacity .22s ease;",
    "}",
    "#mb-cartao[hidden] { display: none; }",
    "#mb-cartao.mb-cartao-visivel { transform: translateY(0); opacity: 1; pointer-events: auto; }",
    "#mb-cartao-titulo { font-weight: 700; font-size: 13.5px; margin-bottom: 4px; }",
    "#mb-cartao-corpo { color: #cbd5e1; line-height: 1.5; }",
    "@media (prefers-reduced-motion: reduce) { #mb-cartao { transition: opacity .22s ease; } }",
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
      '  <span id="mb-banner-titulo">🚨 Novo paciente na fila!</span>' +
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
      "</div>" +
      '<div id="mb-cartao" hidden>' +
      '  <div id="mb-cartao-titulo"></div>' +
      '  <div id="mb-cartao-corpo"></div>' +
      "</div>";

    elMoldura = shadow.getElementById("mb-moldura");
    elBanner = shadow.getElementById("mb-banner");
    elBotao = shadow.getElementById("mb-botao");
    elPainel = shadow.getElementById("mb-painel");
    elCartao = shadow.getElementById("mb-cartao");
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
    if (!shadow) return;
    var titulo = shadow.getElementById("mb-banner-titulo");
    if (titulo) {
      titulo.textContent = motivoAtual === "ainda-aguardando"
        ? "🚨 Paciente ainda aguardando"
        : "🚨 Novo paciente na fila!";
    }
    var el = shadow.getElementById("mb-motivo");
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
      /* Fase de captura: o clique em "Atender" precisa ser visto ANTES de o
       * app trocar de tela e fazer o contador sumir. */
      document.addEventListener("click", aoClicarNaPagina, true);
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
      return {
        tocando: tocando,
        aguardando: quantosAguardando(),
        alertados: alertados,
        intensidade: config && config.intensidade,
      };
    },
    /* Exposto para o teste de reengate (o mesmo defeito da D64 do
     * Assistente Meeds, ver evidenciaFrescaDoContador). Entra direto
     * pelo estado interno, sem depender do polling de 4s do DOM. */
    _definirContador: function (n) { ultimoContador = n; ultimoContadorEm = Date.now(); },
    _envelhecerContador: function (ms) { ultimoContadorEm -= ms; },
    _dispararAlarme: function () { dispararAlarme(); },
    _silenciarComReengate: function () { silenciarComReengate(); },
    _configurar: function (c) { config = Object.assign(config || {}, c); },
    _carregarConfig: function () { carregarConfig(); },
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);

/* ===== partida ===== */
(function (raiz) {
  "use strict";
  raiz.MeedsB.iniciar();
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
