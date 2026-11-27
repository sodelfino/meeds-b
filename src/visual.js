/* ------------------------------------------------------------------
 * src/visual.js — cabecalho branco e sino em SVG, como o Assistente Meeds
 * ------------------------------------------------------------------
 * Copiado de ../meeds-suite/core/cabecalho.js e core/icones.js, em ES5 e
 * com global proprio (MeedsBVisual): o medico pode ter os dois scripts
 * instalados e um nome MeedsSuite* aqui colidiria com o do outro.
 * So desenha; quem liga o clique e o alarme.
 * ------------------------------------------------------------------ */
(function (raiz) {
  "use strict";

  var CSS = [
    ".msc-head {",
    "  background:#fff; color:#1f2a37; padding:16px 18px; display:flex; align-items:center;",
    "  gap:12px; border-bottom:1px solid #eef1f4;",
    "  position:sticky; top:0; z-index:3; border-radius:20px 20px 0 0;",
    "}",
    ".msc-ico { width:40px; height:40px; border-radius:12px; display:flex; align-items:center; justify-content:center; flex:none; }",
    ".msc-ico svg { width:24px; height:24px; display:block; }",
    ".msc-head-txt { min-width:0; flex:1; }",
    ".msc-head h2 { margin:0; font-size:16px; font-weight:700; line-height:1.25; color:#1f2a37; text-wrap:balance; }",
    ".msc-sub { margin:2px 0 0; font-size:13px; line-height:1.35; color:#5b6573; }",
    ".msc-acoes { display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; }",
    ".msc-acao {",
    "  background:#f1f3f5; border:none; color:#1f2a37; border-radius:10px;",
    "  padding:8px 12px; font-size:13px; font-weight:600; font-family:inherit;",
    "  cursor:pointer; white-space:nowrap; line-height:1.3;",
    "}",
    ".msc-acao:hover { background:#e9ecef; }",
    ".msc-acao:focus-visible, .msc-fechar:focus-visible { outline:2px solid #0b7285; outline-offset:2px; }",
    ".msc-fechar {",
    "  background:#f1f3f5; border:none; color:#5b6573;",
    "  width:40px; height:40px; border-radius:12px; flex-shrink:0;",
    "  font-size:16px; line-height:1; cursor:pointer;",
    "}",
    ".msc-fechar:hover { background:#e9ecef; }",
    "@media (max-width:560px) { .msc-head { flex-wrap:wrap; } .msc-acoes { width:100%; justify-content:flex-start; } }",
  ].join("\n");

  function svg(corpo) {
    return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none">' + corpo + "</svg>";
  }
  var SINO = '<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" fill="#FFD8A8" stroke="#D9480F" stroke-width="1.6" stroke-linejoin="round"/>' +
    '<path d="M10 20.2a2.1 2.1 0 0 0 4 0" stroke="#D9480F" stroke-width="1.6" stroke-linecap="round"/>';
  var SINOS = {
    completo: svg(SINO),
    discreto: svg(SINO + '<path d="M20.5 4.5a6 6 0 0 1 0 6" stroke="#D9480F" stroke-width="1.4" stroke-linecap="round"/>'),
    silencioso: svg('<path d="M6 9a6 6 0 0 1 12 0c0 6 2.5 8 2.5 8h-17S6 15 6 9z" fill="#E9ECEF" stroke="#868E96" stroke-width="1.6" stroke-linejoin="round"/>' +
      '<path d="M10 20.2a2.1 2.1 0 0 0 4 0" stroke="#868E96" stroke-width="1.6" stroke-linecap="round"/>' +
      '<path d="M3.5 3.5l17 17" stroke="#E03131" stroke-width="2" stroke-linecap="round"/>'),
  };

  function sino(intensidade) {
    return Object.prototype.hasOwnProperty.call(SINOS, intensidade) ? SINOS[intensidade] : SINOS.completo;
  }

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* cabecalho({ titulo, subtitulo, idFechar }) — icone do sino (tom "alarme"
   * do Assistente: fundo #fff4e6) e o X de fechar com o id dado. */
  function cabecalho(spec) {
    var s = spec || {};
    return (
      '<div class="msc-head">' +
      '<div class="msc-ico" style="background:#fff4e6" aria-hidden="true">' + sino("completo") + "</div>" +
      '<div class="msc-head-txt">' +
      "<h2>" + esc(s.titulo) + "</h2>" +
      (s.subtitulo ? '<p class="msc-sub">' + esc(s.subtitulo) + "</p>" : "") +
      "</div>" +
      '<div class="msc-acoes">' +
      '<button type="button" class="msc-fechar"' +
      (s.idFechar ? ' id="' + esc(s.idFechar) + '"' : "") +
      ' aria-label="Fechar">&#10005;</button>' +
      "</div>" +
      "</div>"
    );
  }

  raiz.MeedsBVisual = { CSS: CSS, cabecalho: cabecalho, sino: sino };
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : typeof window !== "undefined" ? window : globalThis);
