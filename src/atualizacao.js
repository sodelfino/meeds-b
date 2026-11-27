/* ------------------------------------------------------------------
 * src/atualizacao.js — "ha versao nova?" ao clicar no sino
 * ------------------------------------------------------------------
 * Le o `@version` do `.meta.js` publicado (so o cabecalho, centenas de
 * bytes) e compara com a versao em uso. Se houver nova, devolve o
 * endereco do `.user.js` para o medico abrir: o Tampermonkey (ou o app
 * Userscripts, no iPad) mostra a tela de atualizacao dele. So le texto;
 * nada do que chega e executado. Qualquer falha ou prazo estourado
 * (10 s) termina em silencio como "sem versao nova".
 * Adaptado de ../meeds-suite/core/atualizacao.js, em ES5. Sem @grant
 * novo: mudar grants faria o Tampermonkey pedir permissao de novo.
 * O link de instalar NAO leva query string (o Tampermonkey reconhece o
 * `.user.js` pela extensao); so a consulta leva `?t=` para furar cache.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var PRAZO_MS = 10000;
  var BASE = "https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/";

  function extrairVersao(textoMeta) {
    var m = /\/\/\s*@version\s+([0-9]+(?:\.[0-9]+)*)/.exec(String(textoMeta || ""));
    return m ? m[1] : null;
  }

  /* -1, 0 ou 1; numerico por parte ("1.6.10" > "1.6.9") */
  function compararVersoes(a, b) {
    var pa = String(a).split(".");
    var pb = String(b).split(".");
    var n = Math.max(pa.length, pb.length);
    for (var i = 0; i < n; i++) {
      var x = parseInt(pa[i] || "0", 10) || 0;
      var y = parseInt(pb[i] || "0", 10) || 0;
      if (x !== y) return x > y ? 1 : -1;
    }
    return 0;
  }

  /* verificar(versaoAtual, variante, aoTerminar) — variante: "tampermonkey" | "safari"
   * aoTerminar({ nova, versao, instalar }) e chamada exatamente uma vez. */
  function verificar(versaoAtual, variante, aoTerminar) {
    var base = BASE + (variante === "safari" ? "meeds-b.safari" : "meeds-b");
    var encerrado = false;
    var relogio = null;
    var controle = typeof raiz.AbortController === "function" ? new raiz.AbortController() : null;

    function fim(versao) {
      if (encerrado) return;
      encerrado = true;
      if (relogio) clearTimeout(relogio);
      var nova = !!versao && compararVersoes(versao, versaoAtual) > 0;
      aoTerminar({ nova: nova, versao: versao || null, instalar: nova ? base + ".user.js" : null });
    }

    if (typeof raiz.fetch !== "function") return fim(null);
    relogio = setTimeout(function () {
      if (controle) controle.abort();
      fim(null);
    }, PRAZO_MS);
    try {
      raiz
        .fetch(base + ".meta.js?t=" + Date.now(), {
          cache: "no-store",
          credentials: "omit",
          signal: controle ? controle.signal : undefined,
        })
        .then(function (r) {
          if (!r.ok) throw new Error("HTTP " + r.status);
          return r.text();
        })
        .then(function (t) { fim(extrairVersao(t)); })
        .catch(function () { fim(null); });
    } catch (e) {
      fim(null);
    }
  }

  raiz.MeedsBAtualizacao = { extrairVersao: extrairVersao, compararVersoes: compararVersoes, verificar: verificar };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
