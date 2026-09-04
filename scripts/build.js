/* ------------------------------------------------------------------
 * scripts/build.js — junta src/ num userscript so
 * ------------------------------------------------------------------
 * O medico instala UM arquivo. Este script concatena os fontes na ordem
 * de dependencia e escreve dois artefatos:
 *   dist/meeds-b.user.js  — o script inteiro
 *   dist/meeds-b.meta.js  — so o cabecalho, para o Tampermonkey checar
 *                            atualizacao sem baixar o arquivo todo
 *
 * A VERSAO tem uma fonte unica: package.json. O cabecalho e o
 * package.json nunca podem discordar, entao um le do outro.
 * ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));

/* Ordem importa: atencao e som nao dependem de ninguem; fila nao depende
 * de ninguem; alarme depende dos tres. */
const FONTES = ["src/atencao.js", "src/som.js", "src/fila.js", "src/alarme.js"];

const CABECALHO = `// ==UserScript==
// @name         Meeds B — Alarme de fila
// @namespace    novetech-meeds-b
// @version      ${pacote.version}
// @description  Avisa quando entra paciente na fila do Pronto Atendimento do Meeds Doctor, mesmo com a aba de fundo ou o navegador minimizado. Nenhum dado de paciente e lido ou gravado.
// @author       Marcelo
// @match        https://doctor.calltechsaude.com.br/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        unsafeWindow
// @run-at       document-start
// @updateURL    https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.meta.js
// @downloadURL  https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.user.js
// ==/UserScript==
`;

function construir() {
  const partes = FONTES.map((rel) => {
    const caminho = path.join(RAIZ, rel);
    if (!fs.existsSync(caminho)) {
      console.error(`FALTA o arquivo ${rel} — declarado em FONTES e ausente no disco.`);
      process.exit(1);
    }
    return `\n/* ===== ${rel} ===== */\n` + fs.readFileSync(caminho, "utf8");
  });

  const corpo =
    CABECALHO +
    partes.join("\n") +
    `
/* ===== partida ===== */
(function (raiz) {
  "use strict";
  raiz.MeedsB.iniciar();
})(typeof unsafeWindow !== "undefined" ? unsafeWindow : window);
`;

  fs.mkdirSync(path.join(RAIZ, "dist"), { recursive: true });
  fs.writeFileSync(path.join(RAIZ, "dist/meeds-b.user.js"), corpo);
  fs.writeFileSync(path.join(RAIZ, "dist/meeds-b.meta.js"), CABECALHO);

  const kb = Math.round(corpo.length / 1024);
  console.log(`Gerado: dist/meeds-b.user.js (${kb} KB)`);
  console.log(`        dist/meeds-b.meta.js`);
  console.log(`  versao:  ${pacote.version}`);
  console.log(`  fontes:  ${FONTES.length} (${FONTES.map((f) => path.basename(f)).join(", ")})`);
  console.log(`  site:    doctor.calltechsaude.com.br`);
  return corpo;
}

/* --check: regras que o build REPROVA, para nao publicar por engano. */
function verificar(corpo) {
  const problemas = [];

  if (/localhost|127\.0\.0\.1/.test(corpo)) {
    problemas.push("o pacote contem endereco de desenvolvimento (localhost)");
  }
  /* Nenhum dado de paciente pode entrar no codigo — a licao veio do
   * repositorio anterior, que tem CPF de medico no historico do Git. */
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(corpo)) {
    problemas.push("o pacote contem algo com formato de CPF");
  }
  if (!/@match\s+https:\/\/doctor\.calltechsaude\.com\.br/.test(corpo)) {
    problemas.push("o @match nao aponta para o site do Meeds Doctor");
  }
  if (problemas.length) {
    problemas.forEach((p) => console.error("REPROVADO: " + p));
    process.exit(1);
  }
  console.log("OK — cabecalho coerente, sem dado sensivel, sem endereco de teste.");
}

const corpo = construir();
if (process.argv.includes("--check")) verificar(corpo);
