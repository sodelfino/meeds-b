/* ------------------------------------------------------------------
 * tests/som.test.js — a biblioteca de sons continua coerente
 * ------------------------------------------------------------------
 * POR QUE ESTE TESTE EXISTE
 * O modo discreto toca UM som e para; o completo repete. Quem separa os
 * dois e o campo `curto` de cada som. Um som novo entrando sem esse
 * campo cai silenciosamente na lista errada, e o sintoma aparece longe
 * da causa: no discreto, uma sirene tocada uma vez so soa truncada —
 * comeca e para no meio da ideia — e ninguem liga isso a um campo que
 * faltou num objeto.
 *
 * O teste tambem cobre `intervaloMs`, que so o modo completo usa: sem
 * ele, `setInterval(tocar, undefined)` vira um laco de 0ms e o navegador
 * dispara o som milhares de vezes por segundo.
 * ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const ctx = { console };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(path.join(RAIZ, "src/som.js"), "utf8"), ctx);

const SONS = ctx.MeedsBSom;

let falhas = 0;
function ok(nome, cond, detalhe) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome);
  if (!cond) {
    falhas++;
    if (detalhe) console.log("         " + detalhe);
  }
}

const ids = Object.keys(SONS);

ok("a biblioteca carrega e tem sons", ids.length > 0);

/* --- todo som e utilizavel --- */
{
  const semNome = ids.filter((i) => !SONS[i].nome);
  ok("todo som tem nome para aparecer na lista", semNome.length === 0, semNome.join(", "));

  const semTocar = ids.filter((i) => typeof SONS[i].tocar !== "function");
  ok("todo som sabe tocar", semTocar.length === 0, semTocar.join(", "));

  /* `curto` precisa ser declarado, e nao apenas ausente: `undefined`
   * seria lido como "false" e o som iria parar na lista dos que repetem
   * sem ninguem decidir isso. */
  const semCurto = ids.filter((i) => typeof SONS[i].curto !== "boolean");
  ok("todo som declara se e curto ou repetido", semCurto.length === 0,
     "sem o campo `curto`: " + semCurto.join(", "));
}

/* --- o alerta de 3 notas (padrao desde a 1.6) --- */
ok("alerta-3-notas existe e repete", SONS["alerta-3-notas"] && SONS["alerta-3-notas"].curto === false);
ok("alerta-3-notas-curto existe e e curto", SONS["alerta-3-notas-curto"] && SONS["alerta-3-notas-curto"].curto === true);
ok("alerta repete no maximo a cada 2,4 s", SONS["alerta-3-notas"].intervaloMs === 2400);

/* --- as duas listas existem de verdade --- */
{
  const curtos = ids.filter((i) => SONS[i].curto);
  const repetem = ids.filter((i) => !SONS[i].curto);

  ok("ha som para o modo discreto (curto)", curtos.length > 0);
  ok("ha som para o modo completo (repete)", repetem.length > 0);

  /* O padrao de fabrica de cada modo precisa existir NA LISTA CERTA,
   * senao o alarme cai no fallback logo na primeira execucao. */
  ok('o padrao do modo completo ("sirene-classica") existe e repete',
     !!SONS["sirene-classica"] && SONS["sirene-classica"].curto === false);
  ok('o padrao do modo discreto ("toque-duplo") existe e e curto',
     !!SONS["toque-duplo"] && SONS["toque-duplo"].curto === true);

  /* Só quem repete precisa de intervalo. `setInterval` com undefined
   * vira 0ms: o som dispararia milhares de vezes por segundo. */
  const semIntervalo = repetem.filter((i) => !(SONS[i].intervaloMs > 0));
  ok("todo som que repete tem intervaloMs > 0", semIntervalo.length === 0,
     semIntervalo.join(", "));
}

/* --- tocar nao pode explodir --- */
{
  /* AudioContext de mentira: registra o que foi pedido sem produzir som.
   * O que se testa aqui nao e o timbre — e que nenhum som chama um
   * metodo que nao existe e derruba o alarme inteiro. */
  function contextoFalso() {
    const chamadas = { osciladores: 0, ganhos: 0 };
    const no = () => ({
      connect: (destino) => destino || no(),
      frequency: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} },
      start() {}, stop() {},
      type: "",
    });
    return {
      currentTime: 0,
      destination: {},
      createOscillator() { chamadas.osciladores++; return no(); },
      createGain() { chamadas.ganhos++; return no(); },
      createBuffer() { return { getChannelData: () => new Float32Array(64) }; },
      createBufferSource() { chamadas.osciladores++; return no(); },
      sampleRate: 44100,
      _chamadas: chamadas,
    };
  }

  const quebrados = [];
  ids.forEach((id) => {
    const ctxFalso = contextoFalso();
    try {
      SONS[id].tocar(ctxFalso, 0.5);
      if (ctxFalso._chamadas.osciladores === 0) quebrados.push(id + " (nao gerou som)");
    } catch (e) {
      quebrados.push(id + " (" + e.message + ")");
    }
  });
  ok("todo som toca sem erro num contexto de audio", quebrados.length === 0,
     quebrados.join("; "));
}

console.log(falhas ? "\n" + falhas + " FALHA(S)" : "\ntodos passaram");
process.exit(falhas ? 1 : 0);
