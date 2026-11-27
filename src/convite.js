/* ------------------------------------------------------------------
 * src/convite.js — convite guiado para os avisos fora da aba
 * ------------------------------------------------------------------
 * Pergunta ao medico se quer ser avisado quando estiver em outro
 * programa e, se o Chrome bloquear a janelinha, ensina a liberar. So
 * desenha e decide o passo; quem grava a preferencia e o alarme
 * (aoConcluir).
 *
 * ORDEM NO "SIM": a janela abre PRIMEIRO e a permissao de notificacao
 * vem depois. O Chrome so deixa abrir pop-up enquanto o clique do
 * medico ainda esta "quente"; pedir a permissao antes gastaria isso e a
 * janela seria bloqueada sem culpa de ninguem.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var Visual = raiz.MeedsBVisual;

  var CSS = [
    "#mb-convite {",
    "  position: fixed; right: 20px; bottom: 90px; z-index: 2147483002; width: 340px; max-width: calc(100vw - 40px);",
    "  background: #fff; color: #1f2a37; border-radius: 20px; box-shadow: 0 20px 60px rgba(0,0,0,.3);",
    "  font: 400 13.5px/1.5 system-ui, sans-serif; overflow: hidden;",
    "}",
    "#mb-convite[hidden] { display: none; }",
    "#mb-convite .mb-conv-corpo { padding: 14px 18px 4px; }",
    "#mb-convite .mb-conv-corpo p, #mb-convite .mb-conv-corpo ol { margin: 0 0 10px; }",
    "#mb-convite .mb-conv-corpo ol { padding-left: 20px; }",
    "#mb-convite .mb-conv-botoes { display: flex; gap: 8px; flex-wrap: wrap; padding: 6px 18px 16px; }",
    "#mb-convite button.mb-conv-bt {",
    "  border: none; border-radius: 10px; padding: 9px 14px; font: 600 13px system-ui, sans-serif;",
    "  cursor: pointer; background: #f1f3f5; color: #1f2a37;",
    "}",
    "#mb-convite button.mb-conv-bt.principal { background: #0b7285; color: #fff; }",
    "#mb-convite button.mb-conv-bt:focus-visible { outline: 2px solid #0b7285; outline-offset: 2px; }",
  ].join("\n");

  var TEXTO_NEGADA =
    "As notificações estão bloqueadas: clique no cadeado da barra de endereço → Notificações → Permitir.";

  /* criar({ shadow, Atencao, aoConcluir }) -> { abrir, fechar, passo }
   * aoConcluir({ janela?: boolean, visto: true }): `janela` so vem quando o
   * medico decidiu sobre ela — "Agora nao" nao pode desligar uma janela
   * que ele ja tinha ligado. */
  function criar(deps) {
    var shadow = deps.shadow;
    var Atencao = deps.Atencao;
    var aoConcluir = deps.aoConcluir || function () {};
    var caixa = shadow.getElementById("mb-convite");
    var atual = null; // "convite" | "janela-bloqueada" | "pronto" | null

    function cabecalho(titulo) {
      /* o h2 do cabecalho vira o nome do dialogo (aria-labelledby) */
      return Visual.cabecalho({ titulo: titulo, idFechar: "mb-convite-fechar" })
        .replace("<h2>", '<h2 id="mb-convite-titulo">');
    }
    function botao(id, texto, principal) {
      return '<button type="button" class="mb-conv-bt' + (principal ? " principal" : "") +
        '" id="' + id + '">' + texto + "</button>";
    }

    function html() {
      if (atual === "convite") {
        return cabecalho("Ser avisado fora do Meeds?") +
          '<div class="mb-conv-corpo"><p>Quando chegar paciente e você estiver em outro programa, o Meeds pode ' +
          "mostrar um aviso do sistema e deixar uma janelinha na barra de tarefas até você voltar.</p></div>" +
          '<div class="mb-conv-botoes">' + botao("mb-convite-sim", "Sim, ativar", true) +
          botao("mb-convite-nao", "Agora não") + "</div>";
      }
      if (atual === "janela-bloqueada") {
        return cabecalho("O navegador bloqueou a janela") +
          '<div class="mb-conv-corpo"><ol>' +
          "<li>Na barra de endereço, à direita, clique no ícone de janela bloqueada.</li>" +
          "<li>Escolha &quot;Sempre permitir pop-ups e redirecionamentos de doctor.calltechsaude.com.br&quot; e clique em Concluído.</li>" +
          "<li>Clique em Testar de novo.</li></ol></div>" +
          '<div class="mb-conv-botoes">' + botao("mb-convite-testar", "Testar de novo", true) +
          botao("mb-convite-seguir", "Seguir sem a janela") + "</div>";
      }
      var negada = Atencao && Atencao.permissaoDeNotificacao() === "denied";
      return cabecalho("Avisos ligados") +
        '<div class="mb-conv-corpo">' + (negada ? "<p>" + TEXTO_NEGADA + "</p>" : "") + "</div>" +
        '<div class="mb-conv-botoes">' + botao("mb-convite-ok", "Fechar", true) + "</div>";
    }

    /* Cada render troca o HTML; os botoes sao ligados de novo e so agem
     * no passo em que nasceram (um ouvinte velho nao dispara no passo novo). */
    function ligarBotao(id, passoDoBotao, fn) {
      var b = shadow.getElementById(id);
      if (!b) return;
      b.addEventListener("click", function () { if (atual === passoDoBotao) fn(); });
    }

    function mostrar(passoNovo, focoId) {
      atual = passoNovo;
      caixa.innerHTML = html();
      caixa.hidden = false;
      ligarBotao("mb-convite-fechar", passoNovo, aoFechar);
      ligarBotao("mb-convite-sim", "convite", aoSim);
      ligarBotao("mb-convite-nao", "convite", aoFechar);
      ligarBotao("mb-convite-testar", "janela-bloqueada", aoTestar);
      ligarBotao("mb-convite-seguir", "janela-bloqueada", function () { mostrar("pronto", "mb-convite-ok"); });
      ligarBotao("mb-convite-ok", "pronto", fechar);
      var alvo = shadow.getElementById(focoId);
      if (alvo && alvo.focus) alvo.focus();
    }

    /* Tenta a janela de teste; devolve true se abriu (ou se nao se aplica). */
    function tentarJanela() {
      if (!Atencao || !Atencao.suportaJanela()) return { aplica: false, abriu: false };
      var j = Atencao.abrirJanelaDeAviso({
        titulo: "Teste da janela de aviso",
        corpo: "Pode fechar. Quando chegar paciente, ela aparece aqui.",
      });
      if (j) setTimeout(function () { Atencao.fecharJanelaDeAviso(); }, 3000);
      return { aplica: true, abriu: !!j };
    }

    function aoSim() {
      var r = tentarJanela(); // PRIMEIRO a janela (clique quente), depois a permissao
      var pedido = Atencao ? Atencao.pedirPermissaoDeNotificacao() : null;
      aoConcluir({ janela: r.aplica && r.abriu, visto: true });
      if (r.aplica && !r.abriu) mostrar("janela-bloqueada", "mb-convite-testar");
      else mostrar("pronto", "mb-convite-ok");
      /* a resposta do navegador chega depois: redesenha para dizer se negou */
      if (pedido) pedido.then(function () { if (atual === "pronto") mostrar("pronto", "mb-convite-ok"); });
    }

    function aoTestar() {
      var r = tentarJanela();
      if (r.abriu) {
        aoConcluir({ janela: true, visto: true });
        mostrar("pronto", "mb-convite-ok");
      }
    }

    function aoFechar() {
      aoConcluir({ visto: true });
      fechar();
    }

    function fechar() {
      atual = null;
      caixa.hidden = true;
      caixa.innerHTML = "";
    }

    caixa.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape" || !atual) return;
      if (atual === "convite") aoFechar();
      else fechar();
    });

    return {
      abrir: function () { mostrar("convite", "mb-convite-sim"); },
      fechar: fechar,
      passo: function () { return atual; },
    };
  }

  raiz.MeedsBConvite = { CSS: CSS, criar: criar };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
