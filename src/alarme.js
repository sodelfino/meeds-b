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
  var PADRAO_V = 2; // versao do padrao de som, ver carregarConfig()
  var PADRAO = {
    som: "alerta-3-notas",       // usado no modo completo (repete)
    somCurto: "alerta-3-notas-curto", // usado no modo discreto (toca uma vez)
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
  var REENGATE_MS = 60000;         // silenciar sem atender: volta em 1 min
  var INTERVALO_DOM_MS = 4000;
  var DURACAO_CARTAO_MS = 12000;   // quanto o cartao do Discreto fica na tela
  /* Discreto: se o paciente que disparou o alarme continuar na fila, o
   * cartao e as duas batidas voltam a cada 2 min — mais curto que o
   * reengate do Completo (5 min) porque o Discreto e pensado para lembrar
   * com frequencia, sem interromper. Ver agendarRepiqueDeEsperaDiscreto(). */
  var INTERVALO_REPIQUE_DISCRETO_MS = 60000;
  /* espera do mais antigo a partir da qual o Discreto sobe um degrau (faixa + moldura) */
  var DEGRAU_ESPERA_MS = 300000;
  /* id da consulta -> ms de quando entrou na fila; so memoria, nunca disco */
  var vistoDesde = {};

  function esperaDoMaisAntigoMs() {
    var menor = null;
    Object.keys(vistoDesde).forEach(function (id) {
      if (menor === null || vistoDesde[id] < menor) menor = vistoDesde[id];
    });
    return menor === null ? null : Date.now() - menor;
  }
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

  /* A consulta de 15 s e a fonte fresca fora do Pronto Atendimento: 40 s
   * toleram uma consulta perdida. Ver evidenciaFrescaDoContador(). */
  var LIMITE_FRESCOR_CONTADOR_MS = 40000;

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
    /* Migracao do padrao de som (v1.6): quem ainda estava nos padroes
     * antigos passa para o alerta de 3 notas, uma unica vez (padraoV);
     * quem escolheu outro som, ou escolheu o antigo depois, fica como esta. */
    var migrar = guardado.padraoV !== PADRAO_V;
    if (migrar && guardado.som === "sirene-classica") somOk = false;
    if (migrar && guardado.somCurto === "toque-duplo") curtoOk = false;
    config = {
      padraoV: PADRAO_V,
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
    var espera = esperaDoMaisAntigoMs();
    if (espera !== null && espera >= 60000) partes.push("o mais antigo há " + Math.floor(espera / 60000) + " min");
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
    var degrau = motivoAtual === "ainda-aguardando" && modo.som === "curto" &&
      (esperaDoMaisAntigoMs() || 0) >= DEGRAU_ESPERA_MS;
    if (modo.banner || degrau) {
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
    vistoDesde = {};
    if (tocando) silenciarAlarme();
    /* o degrau do Discreto deixa a faixa acesa depois do ciclo curto */
    if (elBanner) elBanner.hidden = true;
    if (elMoldura) elMoldura.hidden = true;
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

  /* origem: "tela" (o gancho viu a tela buscar) ou "consulta" (a nossa) */
  function aoResponderFila(json, origem) {
    if (origem === "tela") respostasDaTela++;
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

    /* so formato reconhecido mexe na espera: "nao sei" nao apaga ninguem */
    if (total !== null) {
      var agoraMs = Date.now();
      var vistoAgora = {};
      Fila.chegadasDaFila(json).forEach(function (c) {
        vistoAgora[c.id] = vistoDesde[c.id] || (c.chegadaMs !== null ? c.chegadaMs : agoraMs);
      });
      vistoDesde = vistoAgora;
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
   * O gancho so LE o que a propria tela ja pediu: copia a resposta e
   * devolve a original intacta. Da chamada da tela ele anota tambem o
   * endereco e os cabecalhos (o token), so em memoria, para a NOSSA
   * consulta — um GET de leitura a cada 15 s no mesmo /queues/mine, que
   * e por definicao a fila do medico logado. Nenhum outro dado e pedido.
   * ------------------------------------------------------------------ */
  var INTERVALO_CONSULTA_MS = 15000;
  var ESPERA_APOS_ERRO_MS = 60000;
  var fetchOriginal = null;
  var urlDaFila = null;           // absoluta, da ultima chamada da tela
  var cabecalhosDaFila = null;    // nome -> valor, da ultima chamada da tela; nunca vai a disco
  /* o modo de credenciais que a tela usou: a chamada dela prova que o CORS da API aceita */
  var credenciaisDaFila = "same-origin";
  var consultaSuspensa = false;   // 401/403: espera a tela buscar de novo (token novo)
  var consultaEmAndamento = false;
  var timerConsulta = null;
  var respostasDaTela = 0;        // so para teste: quantas respostas vieram pelo gancho

  /* Headers, array de pares ou objeto simples -> objeto simples */
  function copiarCabecalhos(h) {
    var saida = {};
    if (!h) return saida;
    if (Array.isArray(h)) {
      h.forEach(function (par) { saida[par[0]] = String(par[1]); });
    } else if (typeof h.forEach === "function") {
      h.forEach(function (valor, nome) { saida[nome] = valor; });
    } else {
      Object.keys(h).forEach(function (nome) { saida[nome] = String(h[nome]); });
    }
    return saida;
  }

  /* A tela acabou de buscar a fila: e o endereco e o token mais novos.
   * A consulta so comeca depois da primeira chamada da tela: antes dela
   * nao se sabe o host da API nem o cabecalho de autenticacao. */
  function anotarChamadaDaTela(url, cabecalhos, credenciais) {
    var primeira = urlDaFila === null;
    try {
      urlDaFila = new URL(url, location.href).href;
    } catch (e) {
      return; // sem endereco confiavel, nao ha o que consultar
    }
    cabecalhosDaFila = cabecalhos;
    credenciaisDaFila = credenciais || "same-origin";
    if (primeira || consultaSuspensa) {
      consultaSuspensa = false;
      agendarConsulta(INTERVALO_CONSULTA_MS);
    }
  }

  /* Um timer so: reagendar substitui o anterior, nunca empilha. */
  function agendarConsulta(ms) {
    if (typeof fetchOriginal !== "function") return;
    if (timerConsulta) clearTimeout(timerConsulta);
    timerConsulta = setTimeout(consultarFilaAgora, ms);
  }

  function consultarFilaAgora() {
    timerConsulta = null;
    if (!urlDaFila) return;
    if (consultaEmAndamento || consultaSuspensa) return agendarConsulta(INTERVALO_CONSULTA_MS);
    consultaEmAndamento = true;
    function falhou() {
      consultaEmAndamento = false;
      agendarConsulta(ESPERA_APOS_ERRO_MS);
    }
    try {
      /* fetchOriginal, nunca raiz.fetch: a nossa consulta nao passa pelo gancho */
      fetchOriginal
        .call(raiz, urlDaFila, {
          method: "GET",
          credentials: credenciaisDaFila,
          cache: "no-store",
          headers: cabecalhosDaFila || {},
        })
        .then(function (resposta) {
          if (resposta.status === 401 || resposta.status === 403) {
            consultaEmAndamento = false;
            consultaSuspensa = true; // sem reagendar: a proxima busca da tela retoma
            return;
          }
          if (!resposta.ok) return falhou();
          return resposta.json().then(function (json) {
            consultaEmAndamento = false;
            aoResponderFila(json, "consulta");
            agendarConsulta(INTERVALO_CONSULTA_MS);
          });
        })
        .catch(falhou);
    } catch (e) {
      falhou();
    }
  }

  function instalarEscutaDeRede() {
    fetchOriginal = raiz.fetch;
    if (typeof fetchOriginal === "function") {
      raiz.fetch = function (entrada, opcoes) {
        var url = typeof entrada === "string" ? entrada : (entrada && entrada.url) || "";
        var promessa = fetchOriginal.apply(this, arguments);
        if (Fila.ehChamadaDaFila(url)) {
          try {
            var pedido = typeof entrada !== "string" && entrada ? entrada : {};
            anotarChamadaDaTela(url, copiarCabecalhos((opcoes && opcoes.headers) || pedido.headers),
              (opcoes && opcoes.credentials) || pedido.credentials);
          } catch (e) {
            /* silencioso: anotar e reforco, nunca pode quebrar a pagina */
          }
          promessa
            .then(function (resposta) {
              /* clone(): ler o corpo consome o stream, e consumir o
               * original deixaria a tela sem os dados dela. */
              resposta.clone().json().then(function (json) { aoResponderFila(json, "tela"); }).catch(function () {});
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
      var cabecalhoOriginal = raiz.XMLHttpRequest.prototype.setRequestHeader;
      if (cabecalhoOriginal) {
        raiz.XMLHttpRequest.prototype.setRequestHeader = function (nome, valor) {
          (this.__meedsBCabecalhos = this.__meedsBCabecalhos || {})[nome] = String(valor);
          return cabecalhoOriginal.apply(this, arguments);
        };
      }
      var enviarOriginal = raiz.XMLHttpRequest.prototype.send;
      raiz.XMLHttpRequest.prototype.send = function () {
        var xhr = this;
        if (Fila.ehChamadaDaFila(xhr.__meedsBUrl)) {
          try {
            anotarChamadaDaTela(xhr.__meedsBUrl, xhr.__meedsBCabecalhos || {},
              xhr.withCredentials ? "include" : "same-origin");
          } catch (e) {
            /* silencioso: anotar e reforco, nunca pode quebrar a pagina */
          }
          xhr.addEventListener("load", function () {
            try {
              if (xhr.status !== 200) return;
              /* Com responseType "json" o responseText LANCA em vez de
               * devolver o texto, e o corpo ja vem como objeto em
               * `response`. Ler so responseText fazia este sinal morrer em
               * silencio num app que configure o XHR assim. */
              var corpo = xhr.responseType === "json" ? xhr.response : JSON.parse(xhr.responseText);
              aoResponderFila(corpo, "tela");
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
    instalarEscutaDeRede(); // a consulta propria comeca na primeira busca da fila pela tela

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
    _aoResponderFila: function (j, origem) { aoResponderFila(j, origem); },
    _estado: function () {
      return {
        tocando: tocando,
        aguardando: quantosAguardando(),
        alertados: alertados,
        intensidade: config && config.intensidade,
        config: config,
        respostasDaTela: respostasDaTela,
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
