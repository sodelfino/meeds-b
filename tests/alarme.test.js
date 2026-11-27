/* ------------------------------------------------------------------
 * tests/alarme.test.js — o ciclo de vida do alarme (src/alarme.js)
 * ------------------------------------------------------------------
 * O defeito que estes testes existem para impedir tem um nome so, e e o
 * que o medico chamou de "paciente preso": o alarme acreditando numa
 * fila que nao e mais a real — ou, no sentido contrario, deixando de
 * acreditar numa que e.
 *
 *   falsa PERSISTENCIA  sirene, titulo "(1)" ou lembrete continuam para
 *                       um paciente que ja foi atendido ou saiu;
 *   falso SILENCIO      ha paciente esperando e ninguem e avisado, ou o
 *                       aviso morre antes da hora.
 *
 * A gravacao de 14/10 mostra de onde vem o risco: o Meeds Doctor empurra
 * a CHEGADA para a tela sem nenhuma requisicao, a fila so e buscada
 * quando o medico clica no menu, e o contador "Aguardando" nem existe
 * fora da tela do Pronto Atendimento. O alarme sabe pouco, e o pouco que
 * sabe envelhece — por isso cada cenario aqui fixa o que ele faz quando
 * a informacao esta velha, ausente ou duplicada.
 *
 * Cada cenario descreve o comportamento CORRETO segundo o README. Um
 * "FALHA" aqui e um defeito, nao uma opiniao.
 * ------------------------------------------------------------------ */
const { ligar, telaFila, telaSemContador, filaReal } = require("./helpers/ambiente-alarme");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs !== undefined ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}
function cenario(nome, fn) {
  console.log("\n" + nome);
  try {
    fn();
  } catch (e) {
    ok("o cenario terminou sem excecao", false, e && e.message);
  }
}

const SEG = 1000;
const MIN = 60 * SEG;
const PAC = [{ nome: "Fulano de Tal", cidade: "macae", novo: true }];
const semTitulo = (t) => !/^\(\d+\)/.test(t);

/* ---------------- a regra de ouro: nao tocar por quem ja estava ---------------- */

cenario("norma 3: ligar com gente ja esperando NAO toca nada agora", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(2, PAC) });
  ok("nenhum som", A.sons.length === 0);
  ok("sem faixa", !A.bannerVisivel());
  ok("sem notificacao", A.notificacoes.length === 0);
  A.responder(filaReal([{ c: "c1", p: "p1" }, { c: "c2", p: "p2" }]));
  ok("a primeira resposta da rede so assenta a base", A.sons.length === 0 && !A.bannerVisivel());
  ok("mas ja conta os 2 (o numero vem da rede)", A.estado().aguardando === 2, String(A.estado().aguardando));
});

cenario("I4: quem ja esperava ao ligar nao toca agora, mas tambem nao e esquecido", () => {
  /* Recarregar a aba (ou o Tampermonkey atualizar o script) com gente na
   * fila nao pode dar sirene — mas tambem nao pode apagar o paciente da
   * memoria do alarme: sem timer nenhum, ele esperaria para sempre. */
  const A = ligar({ intensidade: "completo", tela: telaFila(1, PAC) });
  A.avancar(4 * MIN);
  ok("nada tocou nos primeiros minutos", A.sons.length === 0, String(A.sons.length));
  A.avancar(2 * MIN);
  ok("o lembrete de 5 min chega", A.sons.length > 0, String(A.sons.length));
  ok("e se apresenta como lembrete, nao como chegada",
     /ainda aguardando/i.test(A.ui("mb-banner-titulo").textContent), A.ui("mb-banner-titulo").textContent);
});

/* ---------------- Discreto ---------------- */

cenario("Discreto: chegada mostra o cartao com cidade e contagem, e toca duas vezes", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  const c = A.cartao();
  ok("cartao visivel", c.visivel);
  ok("titulo e de chegada", /Novo paciente na fila/.test(c.titulo), c.titulo);
  ok("mostra a cidade", c.linhas.indexOf("macae") !== -1, JSON.stringify(c.linhas));
  ok("mostra a contagem", c.linhas.some((l) => /1 aguardando/.test(l)), JSON.stringify(c.linhas));
  A.avancar(3 * SEG);
  ok("toca duas vezes", A.sons.length === 2, String(A.sons.length));
  ok("nao e a faixa do modo completo", !A.bannerVisivel());
});

cenario("C3: Discreto volta a cada 2 min enquanto o paciente continua esperando", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  const t0 = A.agora();
  A.avancar(61 * SEG);
  ok("com 1 min ainda so as 2 batidas da chegada", A.sons.length === 2, String(A.sons.length));
  A.avancar(61 * SEG);
  const aos2 = A.sons.filter((s) => s.t - t0 >= 115 * SEG && s.t - t0 <= 135 * SEG).length;
  ok("aos 2 min o lembrete toca de novo (2 batidas)", aos2 === 2, aos2 + " batidas");
  ok("e o cartao diz que ele AINDA espera", /ainda aguardando/i.test(A.cartao().titulo), A.cartao().titulo);
  A.avancar(2 * MIN);
  const aos4 = A.sons.filter((s) => s.t - t0 >= 235 * SEG && s.t - t0 <= 255 * SEG).length;
  ok("e continua: novo lembrete aos 4 min", aos4 === 2, aos4 + " batidas");
});

cenario("Discreto: se a fila esvazia antes do lembrete, ele nao toca", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(30 * SEG);
  A.mostrarTela(telaFila(0, []));
  A.avancar(10 * MIN);
  ok("so as 2 batidas da chegada", A.sons.length === 2, String(A.sons.length));
  ok("titulo da aba limpo", semTitulo(A.titulo()), A.titulo());
});

cenario("Discreto: trocar para Silencioso cancela o lembrete", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(5 * SEG);
  A.mudarIntensidade("silencioso");
  A.avancar(10 * MIN);
  ok("nenhuma batida alem das 2 da chegada", A.sons.length === 2, String(A.sons.length));
});

/* ---------------- falso SILENCIO ---------------- */

cenario("C2: chegada com o contador fora da tela (medico na Agenda) ainda sobe pela escada", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador("Agenda") });
  A.foraDaAba(true);
  A.toast();
  ok("notificacao do sistema", A.notificacoes.length === 1, String(A.notificacoes.length));
  ok("contador no titulo da aba", /^\(1\)/.test(A.titulo()), A.titulo());
  ok("sabe que ha pelo menos 1", A.estado().aguardando >= 1, String(A.estado().aguardando));
});

/* A POLITICA DOS LEMBRETES (D64 — "abstencao nao e prova de ainda cheia")
 *
 * Quem decide se um lembrete pode soar e a IDADE da ultima leitura do
 * contador: ate LIMITE_FRESCOR_CONTADOR_MS (12 s) ele toca; sem leitura
 * fresca, reagenda em silencio no mesmo ritmo e decide quando o medico
 * voltar a tela da fila. Nao desiste — so nao soa sem prova.
 *
 * Esta politica vem do commit 3ea0f33 e do tests/alarme-reengate.test.js,
 * e e ANTERIOR a esta suite. Uma versao anterior destes cenarios afirmava o
 * oposto (lembrar mesmo sem leitura, dizendo "visto ha N min"); o dono do
 * projeto ja tinha decidido o contrario, e a decisao dele vale. O que a
 * suite acrescenta e a CHEGADA em si, fora da tela (C2): ela sobe a escada
 * inteira, porque quem chega nao e um lembrete — e a primeira vez. */
cenario("C2b/D64: chegada fora da tela sobe a escada inteira; o lembrete espera leitura fresca e nao morre", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador("Agenda") });
  A.foraDaAba(true);
  A.toast();
  ok("a chegada notifica", A.notificacoes.length === 1, String(A.notificacoes.length));
  A.avancar(12 * MIN); // o medico segue na Agenda: o contador nao existe
  ok("sem leitura fresca o lembrete nao toca as cegas", A.notificacoes.length === 1, String(A.notificacoes.length));
  ok("mas a contagem nao foi apagada", A.estado().aguardando >= 1, String(A.estado().aguardando));
  A.mostrarTela(telaFila(1, PAC)); // o medico volta a fila e o paciente continua la
  A.avancar(6 * MIN);
  ok("com leitura fresca de fila cheia, o lembrete volta a tocar", A.notificacoes.length >= 2, String(A.notificacoes.length));
});

cenario("C2c/D64: Discreto sem contador legivel — o repique espera leitura fresca e volta com ela", () => {
  const A = ligar({ intensidade: "discreto", tela: telaSemContador("Agenda") });
  A.toast();
  A.avancar(2 * MIN + 10 * SEG);
  ok("so as 2 batidas da chegada: repique nao toca sem leitura", A.sons.length === 2, String(A.sons.length));
  A.mostrarTela(telaFila(1, PAC));
  A.avancar(2 * MIN + 10 * SEG);
  ok("com a fila de volta a tela, o repique toca", A.sons.length === 4, String(A.sons.length));
});

/* ---------------- falsa PERSISTENCIA ---------------- */

cenario("C1: a resposta com a fila vazia zera tudo — nao sobra alarme fantasma", () => {
  const A = ligar({ intensidade: "completo" });
  A.responder(filaReal([]));
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  ok("a sirene esta tocando", A.estado().tocando === true);
  A.mostrarTela(telaSemContador("Consulta")); // o medico foi atender: o contador some
  A.responder(filaReal([]));                  // e a rede diz: ninguem na fila
  ok("calou", A.estado().tocando === false);
  ok("contagem zerada", A.estado().aguardando === 0, String(A.estado().aguardando));
  ok("titulo da aba limpo", semTitulo(A.titulo()), A.titulo());
  const antes = A.sons.length;
  A.avancar(12 * MIN);
  ok("nao volta a tocar nos 12 min seguintes", A.sons.length === antes, A.sons.length - antes + " toques");
});

cenario("C1b: clicar em Atender na fila encerra o alarme, mesmo com a tela mudando na hora", () => {
  const A = ligar({ intensidade: "completo", tela: telaFila(0, []) });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  ok("tocando", A.estado().tocando === true);
  A.clicarNaPagina(A.botao("Atender")); // ainda na tela da fila: o contador esta legivel
  A.mostrarTela(telaSemContador("Consulta"));
  ok("calou", A.estado().tocando === false);
  ok("zerou", A.estado().aguardando === 0, String(A.estado().aguardando));
  const antes = A.sons.length;
  A.avancar(12 * MIN);
  ok("sem lembrete durante a consulta", A.sons.length === antes, A.sons.length - antes + " toques");
});

cenario("C1c: 'Atender' clicado FORA da fila (uma consulta agendada) nao mexe na contagem", () => {
  const A = ligar({ intensidade: "completo", tela: telaSemContador("Agenda") });
  A.toast();
  ok("ha 1 esperando", A.estado().aguardando === 1, String(A.estado().aguardando));
  A.clicarNaPagina(A.botao("Atender")); // botao da Agenda, nao da fila
  ok("continua 1: o paciente da fila nao foi atendido", A.estado().aguardando === 1, String(A.estado().aguardando));
});

cenario("C1d/D64: fora da tela da fila nada toca em cima de contagem velha, e ela nao e inventada nem zerada", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.clicar("mb-silenciar");
  A.mostrarTela(telaSemContador("Consulta")); // o medico foi atender
  const antes = A.sons.length;
  A.avancar(30 * MIN);
  ok("nenhuma sirene em 30 min", A.sons.length === antes, A.sons.length - antes + " toques");
  ok("a contagem continua o ultimo valor visto", A.estado().aguardando === 1, String(A.estado().aguardando));
  A.mostrarTela(telaFila(0, [])); // volta, e a fila esta vazia
  A.avancar(10 * MIN);
  ok("e com a fila vazia a corrente morre: nada toca", A.sons.length === antes, A.sons.length - antes + " toques");
});

cenario("C1e: voltar ao Pronto Atendimento e ler 0 limpa tudo, inclusive o lembrete agendado", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.clicar("mb-silenciar");              // "estou indo": agenda o lembrete de 5 min
  A.mostrarTela(telaSemContador("Consulta"));
  A.avancar(2 * MIN);
  A.mostrarTela(telaFila(0, []));        // volta, e a fila esta vazia
  A.avancar(5 * SEG);
  ok("contagem 0", A.estado().aguardando === 0);
  ok("titulo limpo", semTitulo(A.titulo()), A.titulo());
  const antes = A.sons.length;
  A.avancar(10 * MIN);
  ok("o lembrete agendado nao toca", A.sons.length === antes, A.sons.length - antes + " toques");
});

/* ---------------- sinais duplicados ---------------- */

cenario("H4: abrir o Pronto Atendimento depois da chegada NAO toca de novo", () => {
  /* O app empurra a chegada (toast + contador); o medico silencia, vai
   * para a fila e o clique no menu dispara um GET /queues/mine que traz o
   * MESMO paciente. Para a rede ele e um id "novo" — e o alarme tocava
   * outra vez justamente quando o medico chegava para atender. */
  const A = ligar({ intensidade: "completo" });
  A.responder(filaReal([]));
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(1500);
  A.clicar("mb-silenciar");
  const antes = A.sons.length;
  A.avancar(3 * SEG);
  A.responder(filaReal([{ c: "c1", p: "p1" }]));
  ok("nao tocou de novo", A.sons.length === antes, A.sons.length - antes + " toques");
  ok("sem faixa", !A.bannerVisivel());
  ok("nao esta tocando", A.estado().tocando === false);
});

/* O poll do contador roda a cada 4 s e o toast chega quando chega: se a
 * deduplicacao dependesse da FASE entre os dois, ela funcionaria "por
 * sorte" em alguns plantoes e nao em outros. Estes cenarios varrem a fase
 * e o intervalo entre os dois sinais da mesma chegada. */
cenario("I3: toast e contador da MESMA chegada sao UM alarme, em qualquer fase do poll", () => {
  /* O intervalo vai ate 5 s: com o poll de 4 s por cima, o contador ainda
   * cai dentro da janela de 10 s da "mesma chegada". Mais que isso ja e
   * indistinguivel de um segundo paciente, e tratar como o mesmo seria
   * esconder uma chegada real. */
  const falhou = [];
  for (let fase = 0; fase < 4000; fase += 500) {
    for (const intervalo of [500, 1500, 3500, 5000]) {
      const A = ligar({ intensidade: "discreto" });
      A.avancar(fase);
      A.toast();                          // toast primeiro
      A.avancar(intervalo);
      A.mostrarTela(telaFila(1, PAC));    // o contador renderiza depois
      A.avancar(9 * SEG);
      if (A.sons.length !== 2) falhou.push("fase " + fase + " / +" + intervalo + " ms: " + A.sons.length + " batidas");
    }
  }
  ok("sempre 2 batidas (uma chegada)", falhou.length === 0, falhou.slice(0, 3).join(" | ") + (falhou.length > 3 ? " ... " + falhou.length + " casos" : ""));
});

cenario("I3b: contador primeiro e toast depois sao UM alarme, em qualquer fase", () => {
  const falhou = [];
  for (let fase = 0; fase < 4000; fase += 500) {
    for (const intervalo of [500, 1500, 3500, 5000, 8000]) {
      const A = ligar({ intensidade: "discreto" });
      A.avancar(fase);
      A.mostrarTela(telaFila(1, PAC));    // o contador renderiza primeiro
      A.avancar(intervalo);
      A.toast();                          // e o toast aparece depois
      A.avancar(9 * SEG);
      if (A.sons.length !== 2) falhou.push("fase " + fase + " / +" + intervalo + " ms: " + A.sons.length + " batidas");
    }
  }
  ok("sempre 2 batidas (uma chegada)", falhou.length === 0, falhou.slice(0, 3).join(" | ") + (falhou.length > 3 ? " ... " + falhou.length + " casos" : ""));
});

cenario("saiu um e entrou outro em menos de 10 s: o segundo ainda e avisado, mesmo atrasado", () => {
  /* Dentro da janela da "mesma chegada" o alarme prefere nao repetir — mas
   * entre tocar 10 s tarde e nunca tocar, a primeira e a falha barata. Este
   * cenario existe para impedir que alguem "conserte" a duplicidade
   * absorvendo a leitura: isso engole o segundo paciente para sempre. */
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.avancar(4100);                      // o poll alarma pelo contador: paciente 1
  A.avancar(2 * SEG);
  A.mostrarTela(telaFila(0, []));       // ele sai...
  A.avancar(4100);
  A.mostrarTela(telaFila(1, PAC));      // ...e outro entra, 6 s depois do primeiro alarme
  A.avancar(30 * SEG);
  ok("os dois pacientes foram avisados (2 + 2 batidas)", A.sons.length === 4, String(A.sons.length));
});

cenario("duas chegadas de verdade, separadas por tempo, sao dois alarmes", () => {
  const A = ligar({ intensidade: "discreto" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(30 * SEG);
  A.mostrarTela(telaFila(2, PAC.concat(PAC)));
  A.toast();
  A.avancar(3 * SEG);
  ok("2 + 2 batidas", A.sons.length === 4, String(A.sons.length));
});

/* ---------------- regressao do que ja funcionava ---------------- */

cenario("Completo: sirene repete, para no teto de 120 s e volta em 5 min se ainda ha fila", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  ok("faixa visivel", A.bannerVisivel());
  A.avancar(10 * SEG);
  ok("a sirene repete", A.sons.length >= 5, String(A.sons.length));
  A.avancar(115 * SEG);
  ok("parou no teto de 120 s", !A.estado().tocando && !A.bannerVisivel());
  const n = A.sons.length;
  A.avancar(60 * SEG);
  ok("silencio entre o teto e o reengate", A.sons.length === n);
  A.avancar(250 * SEG);
  ok("o reengate toca e a faixa volta", A.sons.length > n && A.bannerVisivel());
});

cenario("Silenciar: volta em 5 min se ainda ha fila", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.clicar("mb-silenciar");
  ok("silenciou", !A.estado().tocando && !A.bannerVisivel());
  const n = A.sons.length;
  A.avancar(5 * MIN + 10 * SEG);
  ok("voltou a tocar", A.sons.length > n, A.sons.length - n + " toques");
});

cenario("Silenciar: nao volta se a fila esvaziou nesse meio tempo", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.clicar("mb-silenciar");
  const n = A.sons.length;
  A.mostrarTela(telaFila(0, []));
  A.avancar(6 * MIN);
  ok("nao tocou", A.sons.length === n, A.sons.length - n + " toques");
});

cenario("Silencioso: nenhum som e nenhum cartao, mas a escada (aba e notificacao) vale", () => {
  const A = ligar({ intensidade: "silencioso" });
  A.foraDaAba(true);
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  ok("sem som", A.sons.length === 0);
  ok("sem cartao", !A.cartao().visivel);
  ok("com notificacao", A.notificacoes.length === 1, String(A.notificacoes.length));
  ok("com contador na aba", /^\(1\)/.test(A.titulo()), A.titulo());
});

cenario("janela de aviso: o fim natural do ciclo (Discreto e Silencioso) NAO a fecha", () => {
  /* O README diz que a janela "fica na barra de tarefas ate alguem
   * fechar". O fim do toque curto e o do Silencioso passavam por
   * silenciarAlarme(), que a fecha — 4 s depois de aberta. */
  for (const modo of ["discreto", "silencioso"]) {
    const A = ligar({ intensidade: modo, janela: true });
    A.foraDaAba(true);
    A.mostrarTela(telaFila(1, PAC));
    A.toast();
    ok(modo + ": a janela abriu", A.janelas.length === 1, String(A.janelas.length));
    A.avancar(10 * SEG);
    ok(modo + ": continua aberta depois do fim do ciclo", A.janelas[0] && A.janelas[0].closed === false);
  }
});

cenario("janela de aviso: fecha quando a fila esvazia", () => {
  const A = ligar({ intensidade: "silencioso", janela: true });
  A.foraDaAba(true);
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.mostrarTela(telaFila(0, []));
  A.avancar(10 * SEG);
  ok("fechada", A.janelas[0].closed === true);
});

cenario("Silencioso: o lembrete de 5 min continua existindo", () => {
  const A = ligar({ intensidade: "silencioso" });
  A.foraDaAba(true);
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.avancar(5 * MIN + 10 * SEG);
  ok("notificou de novo", A.notificacoes.length >= 2, String(A.notificacoes.length));
});

cenario("a fila esvazia enquanto toca: cala sozinho e limpa a aba", () => {
  const A = ligar({ intensidade: "completo" });
  A.mostrarTela(telaFila(1, PAC));
  A.toast();
  A.mostrarTela(telaFila(0, []));
  A.avancar(5 * SEG);
  ok("nao esta tocando", !A.estado().tocando);
  ok("faixa escondida", !A.bannerVisivel());
  ok("titulo limpo", semTitulo(A.titulo()), A.titulo());
});

cenario("render atrasado: um 0 logo apos o toast NAO cala a propria chegada", () => {
  /* O toast chega antes de o contador renderizar e o poll le "0". Isso e
   * atraso, nao "a fila esvaziou" — calar aqui truncava o alarme da
   * chegada (1 batida em vez de 2, cartao sumindo). */
  const A = ligar({ intensidade: "discreto" });
  A.toast();                       // o DOM ainda mostra 0
  A.avancar(5 * SEG);              // um poll le 0 no meio
  A.mostrarTela(telaFila(1, PAC));
  A.avancar(10 * SEG);
  ok("as 2 batidas foram dadas", A.sons.length === 2, String(A.sons.length));
  ok("e nenhuma terceira", A.sons.filter((s) => s.t - A.sons[0].t > 3000).length === 0);
});

cenario("render atrasado, mas o paciente realmente saiu: passada a janela, o 0 vale", () => {
  const A = ligar({ intensidade: "completo" });
  A.toast();                       // DOM em 0 o tempo todo: nao havia (mais) ninguem
  ok("toca", A.estado().tocando === true);
  A.avancar(20 * SEG);
  ok("calou depois da janela", A.estado().tocando === false);
  ok("contagem zerada", A.estado().aguardando === 0, String(A.estado().aguardando));
  ok("titulo limpo", semTitulo(A.titulo()), A.titulo());
});

cenario("a rede diz 0: cala na hora, sem esperar janela", () => {
  const A = ligar({ intensidade: "completo" });
  A.responder(filaReal([]));
  A.toast();                       // chegada nao confirmada pelo DOM
  A.responder(filaReal([]));       // o servidor diz que nao ha ninguem
  ok("calou", A.estado().tocando === false);
});

cenario("padrao novo do som: migra quem estava no antigo, uma vez so", () => {
  let A = ligar({ guardado: { som: "sirene-classica", somCurto: "toque-duplo", intensidade: "completo" } });
  ok("migra som padrao antigo", A.config().som === "alerta-3-notas" && A.config().somCurto === "alerta-3-notas-curto");
  A = ligar({ guardado: { som: "campainha", somCurto: "gota", intensidade: "completo" } });
  ok("mantem escolha do medico", A.config().som === "campainha" && A.config().somCurto === "gota");
  A = ligar({ guardado: { som: "sirene-classica", somCurto: "toque-duplo", padraoV: 2 } });
  ok("nao migra duas vezes", A.config().som === "sirene-classica");
});

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
