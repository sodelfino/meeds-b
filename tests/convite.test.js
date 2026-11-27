/* tests/convite.test.js — o convite guiado para os avisos fora da aba */
const { ligar } = require("./helpers/ambiente-alarme");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs !== undefined ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}
function cenario(nome, fn) {
  console.log("\n" + nome);
  try { fn(); } catch (e) { ok("o cenario terminou sem excecao", false, e && e.stack); }
}
const passo = (A) => A.passoDoConvite();
const NOVO = { intensidade: "completo", convite: "pendente" };
const IPAD = {
  userAgent: "Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1",
  maxTouchPoints: 5,
};

cenario("aparece uma vez", () => {
  const A = ligar({ guardado: NOVO, assentar: 0 });
  ok("antes dos 3 s nao aparece", passo(A) === null);
  A.avancar(3000);
  ok("passo convite", passo(A) === "convite", passo(A));
  ok("o cartao esta visivel", A.ui("mb-convite").hidden === false);
});

cenario("silencioso nao convida", () => {
  const A = ligar({ guardado: { intensidade: "silencioso", convite: "pendente" }, assentar: 0 });
  A.avancar(3000);
  ok("passo nulo", passo(A) === null);
});

cenario("agora nao grava e nao volta", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000 });
  A.clicar("mb-convite-nao");
  ok("passo nulo", passo(A) === null);
  ok("disco tem convite visto", A.disco()["meeds-b:config"].convite === "visto");
  const B = ligar({ guardado: A.disco()["meeds-b:config"], assentar: 5000 });
  ok("recarregado nao convida", passo(B) === null);
});

cenario("Esc e o X fecham como 'agora nao'", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000 });
  A.teclar("mb-convite", "Escape");
  ok("Esc fecha e grava visto", passo(A) === null && A.disco()["meeds-b:config"].convite === "visto");
  const B = ligar({ guardado: NOVO, assentar: 3000 });
  B.clicar("mb-convite-fechar");
  ok("X fecha e grava visto", passo(B) === null && B.disco()["meeds-b:config"].convite === "visto");
});

cenario("sim com janela ok liga a janela", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, permissaoDeNotificacao: "default" });
  A.clicar("mb-convite-sim");
  ok("passo pronto", passo(A) === "pronto", passo(A));
  ok("janela ligada", A.config().janela === true);
  ok("grava janela e visto", A.disco()["meeds-b:config"].janela === true && A.disco()["meeds-b:config"].convite === "visto");
  ok("a janela de teste fecha em 3 s", (A.avancar(3000), A.janelas[0].closed === true));
});

cenario("abre a janela antes de pedir notificacao", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, permissaoDeNotificacao: "default" });
  A.clicar("mb-convite-sim");
  ok("open vem antes de requestPermission", A.ordem.join(",") === "open,requestPermission", A.ordem.join(","));
});

cenario("janela bloqueada ensina", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, janelaBloqueada: true });
  A.clicar("mb-convite-sim");
  ok("passo janela-bloqueada", passo(A) === "janela-bloqueada", passo(A));
  ok("janela segue desligada", A.config().janela === false);
  ok("ensina o site certo", A.ui("mb-convite").innerHTML.indexOf("doctor.calltechsaude.com.br") !== -1);
  A.bloquearJanela(false);
  A.clicar("mb-convite-testar");
  ok("testar de novo: pronto", passo(A) === "pronto", passo(A));
  ok("janela ligada", A.config().janela === true);
});

cenario("seguir sem a janela", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, janelaBloqueada: true });
  A.clicar("mb-convite-sim");
  A.clicar("mb-convite-seguir");
  ok("passo pronto, janela desligada", passo(A) === "pronto" && A.config().janela === false);
});

cenario("ipad pula a janela", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, navegador: IPAD });
  A.clicar("mb-convite-sim");
  ok("passo pronto", passo(A) === "pronto", passo(A));
  ok("open nunca chamado", A.ordem.indexOf("open") === -1);
});

cenario("pronto avisa quando a notificacao esta negada", () => {
  const A = ligar({ guardado: NOVO, assentar: 3000, permissaoDeNotificacao: "denied" });
  A.clicar("mb-convite-sim");
  ok("explica o cadeado", A.ui("mb-convite").innerHTML.indexOf("As notificações estão bloqueadas") !== -1);
});

cenario("painel reabre", () => {
  const A = ligar({ guardado: { intensidade: "completo", convite: "visto" }, assentar: 5000 });
  ok("nao abriu sozinho", passo(A) === null);
  A.clicar("mb-convite-abrir");
  ok("passo convite", passo(A) === "convite", passo(A));
});

cenario("acessibilidade dos botoes flutuantes", () => {
  const A = ligar({ guardado: NOVO, assentar: 0 });
  const rotulo = A.ui("mb-botao").getAttribute("aria-label");
  ok("sino tem aria-label com o modo", !!rotulo && rotulo.indexOf("completo") !== -1, rotulo);
});

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
