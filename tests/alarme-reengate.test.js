/* ------------------------------------------------------------------
 * tests/alarme-reengate.test.js — src/alarme.js, o reengate
 * ------------------------------------------------------------------
 * MESMA CLASSE DE DEFEITO DA D64 DO ASSISTENTE MEEDS ("abstencao nao e
 * prova de ainda cheia"), com um mecanismo mais simples: aqui nao ha
 * decisor com prazo de validade — so `ultimoContador`, um valor bruto
 * que fica PARADO enquanto o medico nao estiver na tela do Pronto
 * Atendimento (o contador "Aguardando" so existe la).
 *
 * silenciarComReengate() agenda uma checagem 1 min depois
 * (REENGATE_MS). Ate a correcao, essa checagem lia `ultimoContador`
 * direto, sem perguntar HA QUANTO TEMPO aquele numero foi lido. Se o
 * medico silenciou e saiu da tela para atender o paciente, o numero
 * fica congelado no valor de antes — e o reengate, 1 minuto depois,
 * toca a sirene de novo em cima de um numero que pode estar
 * completamente desatualizado.
 *
 * O que se prova aqui:
 *   1. reengate com leitura FRESCA de "ainda cheia" toca de novo
 *      (comportamento original, sem regressao);
 *   2. reengate com leitura FRESCA de "vazia" nao toca e nao reagenda
 *      (idem, sem regressao);
 *   3. reengate com leitura CONGELADA (sem atualizacao ha mais que
 *      LIMITE_FRESCOR_CONTADOR_MS) NAO toca as cegas;
 *   4. mas tambem nao desiste: reagenda a mesma checagem, e quando a
 *      leitura volta a ficar fresca, decide direito.
 * ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

let falhas = 0;
function ok(nome, cond, obs) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome + (obs !== undefined ? "  (" + obs + ")" : ""));
  if (!cond) falhas++;
}

const RAIZ = path.join(__dirname, "..");
const REENGATE_MS = 60000;
const DURACAO_MAX_SOM_MS = 120000;

function carregar() {
  const timeouts = [];
  const intervalos = [];
  let proximoId = 1;
  const chamadasDeSom = [];

  const ctx = {
    console: { debug() {}, warn() {}, log() {} },
    Promise, Date, Math, JSON, Map, Set, Object, Array, String, Number, parseInt, isNaN,
    setInterval: function (fn, atraso) {
      const id = proximoId++;
      intervalos.push({ id, fn, atraso });
      return id;
    },
    clearInterval: () => {},
    setTimeout: function (fn, atraso) {
      const id = proximoId++;
      timeouts.push({ id, fn, atraso, cancelado: false, disparado: false });
      return id;
    },
    clearTimeout: function (id) {
      const t = timeouts.find((x) => x.id === id);
      if (t) t.cancelado = true;
    },
    document: {
      body: {},
      addEventListener() {}, removeEventListener() {},
      createElement: () => ({
        style: {}, setAttribute() {}, appendChild() {}, addEventListener() {},
        attachShadow: () => ({
          appendChild() {},
          innerHTML: "",
          getElementById: () => ({
            addEventListener() {}, appendChild() {}, hidden: true,
            value: "", textContent: "", checked: false, className: "",
            style: {}, title: "", setAttribute() {},
          }),
        }),
      }),
    },
    /* Sinais mockados: alarme.js so precisa do QUE eles expoem, nao de
     * como fila.js/atencao.js/som.js os calculam por dentro. */
    MeedsBFila: {
      lerContadorAguardando: () => null, // este teste entra pelo hook _definirContador
      observarToast: () => function () {},
      ehChamadaDaFila: () => false,
      idsDeFolhas: () => [],
    },
    MeedsBAtencao: {
      marcar() {}, limpar() {}, notificar() {},
      ondeEstaOMedico: () => "dentro",
      aoAcordarDeSuspensao: () => function () {},
      manterTelaAcesa() {},
      suportaJanela: () => false,
      janelaBloqueada: () => false,
      permissaoDeNotificacao: () => "default",
      pedirPermissaoDeNotificacao: () => Promise.resolve(false),
      suportaTelaAcesa: () => false,
      abrirJanelaDeAviso() {},
      fecharJanelaDeAviso() {},
    },
    AudioContext: function () {
      this.state = "running";
      this.resume = () => Promise.resolve();
    },
    MeedsBSom: {
      "sirene-classica": {
        curto: false, intervaloMs: 3000,
        tocar: () => { chamadasDeSom.push("sirene-classica"); },
      },
      "toque-duplo": {
        curto: true,
        tocar: () => { chamadasDeSom.push("toque-duplo"); },
      },
    },
  };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.addEventListener = function () {};
  ctx.removeEventListener = function () {};
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "src/visual.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "src/convite.js"), "utf8"), ctx);
  vm.runInContext(fs.readFileSync(path.join(RAIZ, "src/alarme.js"), "utf8"), ctx);

  const api = ctx.MeedsB;
  api._carregarConfig();
  api._configurar({ intensidade: "completo" });

  return { api, timeouts, chamadasDeSom };
}

function dispararTimeout(timeouts, atrasoExato) {
  const candidatos = timeouts.filter((t) => t.atraso === atrasoExato && !t.disparado && !t.cancelado);
  const alvo = candidatos[candidatos.length - 1];
  if (!alvo) return null;
  alvo.disparado = true;
  alvo.fn();
  return alvo;
}

function pendente(timeouts, atrasoExato) {
  const candidatos = timeouts.filter((t) => t.atraso === atrasoExato && !t.disparado && !t.cancelado);
  return candidatos[candidatos.length - 1] || null;
}

/* Leva do zero ate "silenciado, reengate agendado": dispara com fila
 * cheia, deixa a trava de 2 min da sirene estourar (o caminho real quando
 * ninguem clica em "Silenciar" a tempo). */
function chegarNoReengateAgendado(api, timeouts) {
  api._definirContador(3); // fila cheia no momento do disparo
  api._dispararAlarme();
  dispararTimeout(timeouts, DURACAO_MAX_SOM_MS); // trava -> silenciarComReengate()
}

/* ------------------------------------------------------------------
 * 1. CONTROLE — leitura FRESCA de "ainda cheia": toca de novo.
 * ------------------------------------------------------------------ */
{
  const { api, timeouts, chamadasDeSom } = carregar();
  chegarNoReengateAgendado(api, timeouts);
  ok("1 som ate aqui (disparo original)", chamadasDeSom.length === 1, chamadasDeSom.length);

  api._definirContador(2); // leitura FRESCA, ainda tem gente
  dispararTimeout(timeouts, REENGATE_MS);

  ok(
    "com leitura fresca de fila cheia, o reengate TOCA de novo",
    chamadasDeSom.length === 2,
    chamadasDeSom.length
  );
}

/* ------------------------------------------------------------------
 * 2. CONTROLE — leitura FRESCA de "vazia": nao toca, nao reagenda.
 * ------------------------------------------------------------------ */
{
  const { api, timeouts, chamadasDeSom } = carregar();
  chegarNoReengateAgendado(api, timeouts);

  api._definirContador(0); // leitura FRESCA, fila vazia de verdade
  dispararTimeout(timeouts, REENGATE_MS);

  ok("com leitura fresca de fila vazia, NAO toca de novo", chamadasDeSom.length === 1);
  ok("e a corrente termina — nao reagenda mais nada", !pendente(timeouts, REENGATE_MS));
}

/* ------------------------------------------------------------------
 * 3. O ALARME FANTASMA — leitura CONGELADA nao pode tocar as cegas.
 * ------------------------------------------------------------------
 * Reproduz o cenario real: o medico silenciou, saiu da tela da fila
 * para atender o paciente, e o contador nunca mais foi lido. Passados
 * o minuto do reengate, o ultimo numero conhecido (3) continua
 * dizendo "cheia" — mas ele tem 1 minuto de idade, nao segundos.
 * ------------------------------------------------------------------ */
{
  const { api, timeouts, chamadasDeSom } = carregar();
  chegarNoReengateAgendado(api, timeouts);
  ok("1 som ate aqui (disparo original)", chamadasDeSom.length === 1);

  api._envelhecerContador(REENGATE_MS); // o numero (3) tem 1 min de idade
  dispararTimeout(timeouts, REENGATE_MS);

  ok(
    "leitura CONGELADA (1 min de idade) NAO toca a sirene de novo",
    chamadasDeSom.length === 1,
    chamadasDeSom.length
  );
  ok(
    "mas a corrente nao morre: reagenda outra checagem, na mesma cadencia",
    !!pendente(timeouts, REENGATE_MS)
  );
}

/* ------------------------------------------------------------------
 * 4. A CORRENTE SE AUTOCURA — quando a leitura volta a ficar fresca
 *    (o medico voltou para a tela da fila), a proxima checagem decide
 *    direito, sem precisar de um disparo externo.
 * ------------------------------------------------------------------ */
{
  const { api, timeouts, chamadasDeSom } = carregar();
  chegarNoReengateAgendado(api, timeouts);

  api._envelhecerContador(REENGATE_MS); // 1a checagem: congelada, so reagenda
  dispararTimeout(timeouts, REENGATE_MS);
  ok("1a checagem, congelada: nao tocou", chamadasDeSom.length === 1);

  api._definirContador(1); // medico voltou a tela: leitura fresca de novo
  dispararTimeout(timeouts, REENGATE_MS); // 2a checagem, ja reagendada pela 1a
  ok(
    "2a checagem, agora fresca: toca — a corrente nao se perdeu",
    chamadasDeSom.length === 2,
    chamadasDeSom.length
  );
}

/* ------------------------------------------------------------------
 * 5. SEM FILA NENHUMA NO MOMENTO DE SILENCIAR, NAO HA O QUE REENGATAR.
 *    Controle do comportamento original (silenciarComReengate so
 *    agenda quando havia fila ao silenciar).
 * ------------------------------------------------------------------ */
{
  const { api, timeouts } = carregar();
  api._definirContador(0);
  api._dispararAlarme(); // nao deveria normalmente disparar com 0, mas testamos o reengate isolado
  api._silenciarComReengate();
  ok("sem fila ao silenciar, nenhum reengate e agendado", !pendente(timeouts, REENGATE_MS));
}

console.log(falhas ? `\n${falhas} FALHA(S)` : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
