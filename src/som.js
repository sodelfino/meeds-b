/* ------------------------------------------------------------------
 * src/som.js — a biblioteca de sons do alarme
 * ------------------------------------------------------------------
 * Sintetizados por osciladores (Web Audio), sem arquivo externo: o
 * alarme precisa tocar mesmo com a rede da unidade ruim, e um mp3 que
 * nao baixou e um alarme mudo. Vem do Assistente Meeds
 * (sodelfino/meeds-suite), onde ja rodou plantao de verdade.
 *
 * SAO DUAS LISTAS, E O CAMPO `curto` E QUEM AS SEPARA
 * As sirenes foram feitas para REPETIR: tocadas uma vez so, soam
 * truncadas — comecam e param no meio da ideia. Os sons `curto: true`
 * tem comeco, meio e fim em menos de um segundo e terminam decaindo em
 * vez de cortar. O modo discreto usa os curtos; o completo, os que
 * repetem. `tests/som.test.js` cobra o campo de todo som novo.
 *
 * Todos sobem o ganho a partir de ZERO em alguns milissegundos e descem
 * quase a zero antes de parar o oscilador. Sem essa rampa o navegador
 * produz um estalo no inicio e no fim — audivel, feio, e pior ainda num
 * fone de plantao noturno.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  /* Tres pulsos de 150 ms (0 / 0,2 / 0,4 s), mi-la-Do# subindo. Triangulo
   * mais um seno no dobro da frequencia (30% do ganho) para dar corpo sem
   * estridencia; rampa de 10 ms na subida e exponencial no fim, sem estalo. */
  function tocarAlerta3Notas(ctx, volume) {
    var agora = ctx.currentTime;
    [659.25, 880, 1108.73].forEach(function (f, i) {
      var t = agora + i * 0.2;
      [{ f: f, tipo: "triangle", v: 1 }, { f: f * 2, tipo: "sine", v: 0.3 }].forEach(function (p) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = p.tipo;
        osc.frequency.setValueAtTime(p.f, t);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.32 * p.v * volume, t + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
        osc.connect(g).connect(ctx.destination);
        osc.start(t);
        osc.stop(t + 0.16);
      });
    });
  }

  var TIPOS_DE_SOM = {
    "alerta-3-notas": {
      nome: "Alerta (3 notas)",
      curto: false,
      intervaloMs: 2400,
      tocar: tocarAlerta3Notas,
    },
    "alerta-3-notas-curto": {
      nome: "Alerta curto (3 notas)",
      curto: true,
      intervaloMs: 1400,
      tocar: tocarAlerta3Notas,
    },
    "sirene-classica": {
      nome: "Sirene clássica (2 notas)",
      curto: false,
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
      curto: false,
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
      curto: false,
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
      curto: false,
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
  
    /* ----------------------------------------------------------------
     * SONS DE TOQUE UNICO (modo discreto)
     * ----------------------------------------------------------------
     * As quatro sirenes acima foram feitas para REPETIR: tocadas uma vez
     * so, soam truncadas — comecam e param no meio da ideia. Estas tem
     * comeco, meio e fim em menos de um segundo, e terminam decaindo em
     * vez de cortar.
     *
     * Todas sobem o ganho a partir de ZERO em alguns milissegundos e
     * descem quase a zero antes de parar o oscilador. Sem essa rampa o
     * navegador produz um estalo no inicio e no fim — audivel, feio, e
     * pior ainda num fone de plantao noturno.
     * ---------------------------------------------------------------- */
    "toque-duplo": {
      nome: "Toque duplo (dois tons)",
      curto: true,
      intervaloMs: 1200,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        [{ f: 880, t: 0 }, { f: 1174.7, t: 0.13 }].forEach(function (n) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "triangle";
          osc.frequency.setValueAtTime(n.f, agora + n.t);
          g.gain.setValueAtTime(0.0001, agora + n.t);
          g.gain.linearRampToValueAtTime(0.32 * volume, agora + n.t + 0.012);
          g.gain.exponentialRampToValueAtTime(0.0008, agora + n.t + 0.34);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + n.t);
          osc.stop(agora + n.t + 0.36);
        });
      },
    },
    "sino-curto": {
      nome: "Sino curto",
      curto: true,
      intervaloMs: 1400,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Um sino e a fundamental MAIS um parcial agudo que morre antes
         * dela — e o que separa "sino" de "bipe". */
        [{ f: 1568, v: 0.3, d: 0.9 }, { f: 2350, v: 0.12, d: 0.35 }].forEach(function (n) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(n.f, agora);
          g.gain.setValueAtTime(0.0001, agora);
          g.gain.linearRampToValueAtTime(n.v * volume, agora + 0.008);
          g.gain.exponentialRampToValueAtTime(0.0006, agora + n.d);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora);
          osc.stop(agora + n.d + 0.02);
        });
      },
    },
    "gota": {
      nome: "Gota (bem discreto)",
      curto: true,
      intervaloMs: 900,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "sine";
        osc.frequency.setValueAtTime(1250, agora);
        osc.frequency.exponentialRampToValueAtTime(620, agora + 0.14);
        g.gain.setValueAtTime(0.0001, agora);
        g.gain.linearRampToValueAtTime(0.3 * volume, agora + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0007, agora + 0.28);
        osc.connect(g).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 0.3);
      },
    },
    "acorde-suave": {
      nome: "Acorde suave (três notas)",
      curto: true,
      intervaloMs: 1600,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        [523.25, 659.25, 783.99].forEach(function (f, i) {
          var t = i * 0.075;
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(f, agora + t);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.22 * volume, agora + t + 0.015);
          g.gain.exponentialRampToValueAtTime(0.0006, agora + t + 0.55);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.58);
        });
      },
    },
    "dois-cliques": {
      nome: "Dois cliques (quase mudo)",
      curto: true,
      intervaloMs: 800,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Para quem divide a sala com outro profissional e nao quer que o
         * alarme vire assunto da consulta ao lado. */
        [0, 0.09].forEach(function (t) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "square";
          osc.frequency.setValueAtTime(2100, agora + t);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.12 * volume, agora + t + 0.004);
          g.gain.exponentialRampToValueAtTime(0.0005, agora + t + 0.035);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.04);
        });
      },
    },

    /* ----------------------------------------------------------------
     * MAIS DUAS PARA O MODO COMPLETO
     * ---------------------------------------------------------------- */
    "pulso-grave": {
      nome: "Pulso grave (plantão noturno)",
      curto: false,
      intervaloMs: 1300,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        /* Grave atravessa parede e cansa menos que agudo. Pensado para a
         * madrugada, quando o estridente e justamente o que faz o medico
         * desligar o alarme — e perder o paciente seguinte. */
        [0, 0.42].forEach(function (t) {
          var osc = ctx.createOscillator();
          var g = ctx.createGain();
          osc.type = "sine";
          osc.frequency.setValueAtTime(196, agora + t);
          osc.frequency.linearRampToValueAtTime(233, agora + t + 0.3);
          g.gain.setValueAtTime(0.0001, agora + t);
          g.gain.linearRampToValueAtTime(0.42 * volume, agora + t + 0.03);
          g.gain.exponentialRampToValueAtTime(0.0008, agora + t + 0.34);
          osc.connect(g).connect(ctx.destination);
          osc.start(agora + t);
          osc.stop(agora + t + 0.36);
        });
      },
    },
    "sirene-lenta": {
      nome: "Sirene lenta (menos estridente)",
      curto: false,
      intervaloMs: 1500,
      tocar: function (ctx, volume) {
        var agora = ctx.currentTime;
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(560, agora);
        osc.frequency.linearRampToValueAtTime(760, agora + 0.55);
        osc.frequency.linearRampToValueAtTime(560, agora + 1.1);
        g.gain.setValueAtTime(0.0001, agora);
        g.gain.linearRampToValueAtTime(0.34 * volume, agora + 0.06);
        g.gain.setValueAtTime(0.34 * volume, agora + 1.0);
        g.gain.linearRampToValueAtTime(0.0001, agora + 1.12);
        osc.connect(g).connect(ctx.destination);
        osc.start(agora);
        osc.stop(agora + 1.15);
      },
    },
};

  raiz.MeedsBSom = TIPOS_DE_SOM;
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
