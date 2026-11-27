/* ------------------------------------------------------------------
 * scripts/build.js — junta src/ num userscript so
 * ------------------------------------------------------------------
 * O medico instala UM arquivo. Este script concatena os fontes na ordem
 * de dependencia e escreve QUATRO artefatos — dois pares, mesmo corpo:
 *   dist/meeds-b.user.js         — Tampermonkey (Windows/Mac/Android)
 *   dist/meeds-b.meta.js         — so o cabecalho desse, para checar
 *                                   atualizacao sem baixar o pacote todo
 *   dist/meeds-b.safari.user.js  — Safari no iPad/iPhone/Mac, app
 *                                   Userscripts (`@grant none`)
 *   dist/meeds-b.safari.meta.js  — idem, so o cabecalho
 *
 * A VERSAO tem uma fonte unica: package.json. Os cabecalhos e o
 * package.json nunca podem discordar, entao eles leem dele.
 * ------------------------------------------------------------------ */
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const pacote = JSON.parse(fs.readFileSync(path.join(RAIZ, "package.json"), "utf8"));

/* Ordem importa: atencao e som nao dependem de ninguem; fila nao depende
 * de ninguem; visual nao depende de ninguem; alarme depende dos quatro. */
const FONTES = ["src/atencao.js", "src/som.js", "src/fila.js", "src/visual.js", "src/alarme.js"];

const CABECALHO = `// ==UserScript==
// @name         Meeds B — Alarme de fila
// @namespace    novetech-meeds-b
// @version      ${pacote.version}
// @description  Avisa quando entra paciente na fila do Pronto Atendimento do Meeds Doctor, mesmo com a aba de fundo ou o navegador minimizado. So o nome do paciente nunca e lido nem gravado.
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

  const corpoSafari = construirSafari(corpo);

  const kb = Math.round(corpo.length / 1024);
  const kbSafari = Math.round(corpoSafari.length / 1024);
  console.log(`Gerado: dist/meeds-b.user.js (${kb} KB)`);
  console.log(`        dist/meeds-b.meta.js`);
  console.log(`  versao:  ${pacote.version}`);
  console.log(`  fontes:  ${FONTES.length} (${FONTES.map((f) => path.basename(f)).join(", ")})`);
  console.log(`  site:    doctor.calltechsaude.com.br`);
  console.log(`  safari:  dist/meeds-b.safari.user.js (${kbSafari} KB) — @grant none, @inject-into auto`);
  console.log("\nTampermonkey (Windows/Mac/Android): dist/meeds-b.user.js");
  console.log("Safari no iPad/iPhone/Mac (app Userscripts): dist/meeds-b.safari.user.js");
  return { corpo, corpoSafari };
}

/* ------------------------------------------------------------------
 * VARIANTE SAFARI — mesmo corpo, outro cabecalho
 * ------------------------------------------------------------------
 * O app Userscripts (a extensao que faz Tampermonkey existir no Safari
 * do iPad/iPhone) so injeta no escopo da pagina quando o script pede
 * `@grant none` — qualquer @grant de GM joga para o escopo isolado, e
 * ali o hook de fetch/XHR deste script (instalarEscutaDeRede, em
 * src/alarme.js) deixa de enxergar as chamadas que a PROPRIA aba do
 * Meeds Doctor faz. O alarme perderia o sinal de rede (Sinal C) e
 * ficaria so com o toast e o contador do DOM.
 *
 * `@inject-into auto`, nao `page`: com `page` a extensao injeta uma tag
 * <script> na pagina, e uma CSP estrita pode recusar executa-la — o
 * script aparece instalado no popup e mesmo assim nada acontece na
 * tela. `auto` tenta a pagina primeiro e cai para o escopo isolado se a
 * CSP barrar (perdendo so o Sinal C, nao o script inteiro).
 *
 * As chamadas GM_getValue/GM_setValue em src/alarme.js (funcao ler/
 * gravar) ja caem para localStorage quando essas globais nao existem —
 * e exatamente o caso aqui, com `@grant none`. Nenhuma mudanca de
 * codigo foi necessaria nos fontes por causa disso.
 * ------------------------------------------------------------------ */
function construirSafari(corpoTampermonkey) {
  const fim = corpoTampermonkey.indexOf("// ==/UserScript==");
  let meta = corpoTampermonkey.slice(0, fim);
  const resto = corpoTampermonkey.slice(fim);

  meta = meta
    /* O @name vira o NOME DO ARQUIVO salvo pelo app Userscripts — a
     * documentacao dele e explicita sobre isso. "/" e ":" sao proibidos
     * em nome de arquivo no iOS; o travessao do nome original nao é
     * nenhum dos dois, entao passa como esta, so com o sufixo. */
    .replace(/\/\/ @name\s+.*\n/, "// @name         Meeds B — Alarme de fila para iPad - por Marcelo\n")
    .replace(/\/\/ @namespace\s+.*\n/, "// @namespace    novetech-meeds-b-safari\n")
    // sai todo @grant e entra "none": e o que mantem o script no escopo
    // da pagina, onde o hook de rede funciona
    .replace(/\/\/ @grant\s+.*\n/g, "")
    .replace(/(\/\/ @run-at\s+.*\n)/, "// @grant        none\n// @inject-into auto\n$1")
    .replace(
      /\/\/ @updateURL\s+.*\n/,
      "// @updateURL    https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.meta.js\n"
    )
    .replace(
      /\/\/ @downloadURL\s+.*\n/,
      "// @downloadURL  https://raw.githubusercontent.com/sodelfino/meeds-b/main/dist/meeds-b.safari.user.js\n"
    );

  const corpoSafari = meta + resto;

  fs.writeFileSync(path.join(RAIZ, "dist/meeds-b.safari.user.js"), corpoSafari);
  fs.writeFileSync(
    path.join(RAIZ, "dist/meeds-b.safari.meta.js"),
    corpoSafari.slice(0, corpoSafari.indexOf("// ==/UserScript==")) + "// ==/UserScript==\n"
  );

  return corpoSafari;
}

/* --check: regras que o build REPROVA, para nao publicar por engano.
 * Roda nos DOIS corpos — Tampermonkey e Safari — porque sao pacotes
 * publicados separados, e um erro so no cabecalho Safari (o @grant
 * errado, por exemplo) nao apareceria checando so o outro. */
function verificarUm(corpo, rotulo) {
  const problemas = [];

  if (/localhost|127\.0\.0\.1/.test(corpo)) {
    problemas.push(`[${rotulo}] o pacote contem endereco de desenvolvimento (localhost)`);
  }
  /* Nenhum dado de paciente pode entrar no codigo — a licao veio do
   * repositorio anterior, que tem CPF de medico no historico do Git. */
  if (/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/.test(corpo)) {
    problemas.push(`[${rotulo}] o pacote contem algo com formato de CPF`);
  }
  if (!/@match\s+https:\/\/doctor\.calltechsaude\.com\.br/.test(corpo)) {
    problemas.push(`[${rotulo}] o @match nao aponta para o site do Meeds Doctor`);
  }
  return problemas;
}

function verificar(corpo, corpoSafari) {
  const problemas = [
    ...verificarUm(corpo, "tampermonkey"),
    ...verificarUm(corpoSafari, "safari"),
  ];

  /* So a variante Safari pode ter @grant none — e ela PRECISA ter,
   * senao o app Userscripts joga o script para o escopo isolado e o
   * hook de rede (Sinal C) fica cego. */
  if (!/@grant\s+none/.test(corpoSafari)) {
    problemas.push("[safari] falta @grant none no cabecalho");
  }
  if (/@grant\s+GM_/.test(corpoSafari)) {
    problemas.push("[safari] ainda tem @grant de GM_* — devia ter saido todo");
  }
  if (!/@inject-into\s+auto/.test(corpoSafari)) {
    problemas.push("[safari] falta @inject-into auto");
  }
  if (!/@grant\s+GM_setValue/.test(corpo) || !/@grant\s+GM_getValue/.test(corpo)) {
    problemas.push("[tampermonkey] perdeu um @grant de GM_* que devia ter");
  }
  // nomes de arquivo do iOS nao aceitam "/" nem ":" no @name
  const nomeSafari = (corpoSafari.match(/\/\/ @name\s+(.*)\n/) || [])[1] || "";
  if (/[/:]/.test(nomeSafari)) {
    problemas.push(`[safari] @name "${nomeSafari}" tem "/" ou ":", nao pode virar nome de arquivo no iOS`);
  }

  if (problemas.length) {
    problemas.forEach((p) => console.error("REPROVADO: " + p));
    process.exit(1);
  }
  console.log("OK — os dois cabecalhos coerentes, sem dado sensivel, sem endereco de teste.");
}

const { corpo, corpoSafari } = construir();
if (process.argv.includes("--check")) verificar(corpo, corpoSafari);
