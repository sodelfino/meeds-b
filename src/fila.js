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
