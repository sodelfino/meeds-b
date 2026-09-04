// ==UserScript==
// @name         Meeds B — Alarme de fila
// @namespace    novetech-meeds-b
// @version      1.0.0
// @description  Avisa quando entra paciente na fila do Pronto Atendimento do Meeds Doctor, mesmo com a aba de fundo ou o navegador minimizado. Nenhum dado de paciente e lido ou gravado.
// @author       Marcelo
// @match        https://doctor.calltechsaude.com.br/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.meta.js
// @downloadURL  https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.user.js
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
  var TAG_PADRAO = "meeds-suite";

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
    /* expostos para teste */
    _marcarTitulo: marcarTitulo,
    _limparTitulo: limparTitulo,
  };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);


/* ===== src/som.js ===== */
/* ------------------------------------------------------------------
 * src/som.js — os quatro sons do alarme
 * ------------------------------------------------------------------
 * Sintetizados por osciladores (Web Audio), sem arquivo externo: o
 * alarme precisa tocar mesmo com a rede da unidade ruim, e um mp3 que
 * nao baixou e um alarme mudo. Copiado do Assistente Meeds
 * (sodelfino/meeds-suite), onde ja rodou plantao de verdade.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var TIPOS_DE_SOM = {
    "sirene-classica": {
      nome: "Sirene clássica (2 notas)",
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
 * API era conhecido. Aqui e o contrario: o corpo de /queues/mine nunca
 * foi visto, e o DOM foi. Desenhar em cima do que se observou, e nao do
 * que se imagina, e o que separa um alarme que funciona de um que so
 * parece funcionar.
 *
 * PRIVACIDADE: nada de paciente sai daqui. Os ids de atendimento vivem
 * em memoria e morrem com a aba; nenhum nome, CPF ou queixa e lido,
 * gravado ou enviado. O aviso fala em quantidade e tempo, nunca em
 * gente.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var doc = typeof document !== "undefined" ? document : null;

  /* Texto que o proprio app usa quando chega alguem. Fica aqui em cima,
   * sozinho, porque e a coisa mais provavel de mudar quando o Meeds
   * Doctor for atualizado — e a primeira que alguem vai querer corrigir. */
  var TEXTO_DO_TOAST = "novo paciente na fila";
  var ROTULO_AGUARDANDO = "aguardando";
  var CAMINHO_DA_FILA = "/api/doctor/queues/mine";

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
          var texto = normalizar(no.textContent);
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
   * Leitura GENERICA de proposito. O corpo desse endereco nunca foi
   * observado; contar objetos com "id" funciona com lista solta, com
   * lista dentro de "data", com filas aninhadas — e devolve null (nao
   * vota) se o formato for outro. Um palpite errado sobre nome de campo
   * daria um alarme que nao toca, que e a pior falha possivel aqui.
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

  raiz.MeedsBFila = {
    lerContadorAguardando: lerContadorAguardando,
    observarToast: observarToast,
    ehChamadaDaFila: ehChamadaDaFila,
    idsDeFolhas: idsDeFolhas,
    normalizar: normalizar,
    TEXTO_DO_TOAST: TEXTO_DO_TOAST,
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

/* ===== partida ===== */
(function (raiz) {
  "use strict";
  raiz.MeedsB.iniciar();
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
