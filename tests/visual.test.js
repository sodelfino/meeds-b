/* tests/visual.test.js — src/visual.js (cabecalho e sino em SVG) */
const fs = require("fs");
const vm = require("vm");
let falhas = 0;
function ok(nome, cond) {
  console.log((cond ? "  ok   " : "  FALHA ") + nome);
  if (!cond) falhas++;
}
const ctx = { console, Object, String };
ctx.window = ctx;
ctx.globalThis = ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync(require("path").join(__dirname, "..", "src", "visual.js"), "utf8"), ctx);
const V = ctx.MeedsBVisual;

["completo", "discreto", "silencioso"].forEach(function (i) {
  ok("sino " + i + " e svg", /^<svg[\s\S]*<\/svg>$/.test(V.sino(i)));
});
ok("sinos sao diferentes entre si", V.sino("completo") !== V.sino("discreto") && V.sino("discreto") !== V.sino("silencioso"));
ok("intensidade invalida cai no completo", V.sino("x") === V.sino("completo"));
ok("intensidade 'toString' nao quebra", V.sino("toString") === V.sino("completo"));
ok("cabecalho escapa titulo", V.cabecalho({ titulo: "<b>", idFechar: "f" }).indexOf("&lt;b&gt;") > -1);
ok("cabecalho usa o id do fechar", V.cabecalho({ titulo: "t", idFechar: "mb-fechar" }).indexOf('id="mb-fechar"') > -1);
ok("cabecalho mostra o subtitulo", V.cabecalho({ titulo: "t", subtitulo: "sub" }).indexOf(">sub<") > -1);
ok("CSS e texto com msc-head", typeof V.CSS === "string" && V.CSS.indexOf(".msc-head") > -1);

if (falhas) { console.log("\n" + falhas + " falha(s)"); process.exit(1); }
console.log("\ntudo certo");
