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
