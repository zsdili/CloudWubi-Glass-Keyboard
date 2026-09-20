// 端侧极简码表：一/二/三级简码全留（五笔快速输入核心）；全码单字只留 top1500 常用字；其余单字与全部词组云端按需加载。
const fs = require("fs");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));
const groups = new Map();
function parse(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t"); if (p.length < 2) continue;
    const text = p[0].trim(), code = p[1].trim(), f = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if (!text || !/^[a-y]{1,4}$/.test(code) || [...text].length !== 1 || !GSC.has(text)) continue;
    if (!groups.has(code)) groups.set(code, new Map());
    const m = groups.get(code);
    if (!m.has(text) || f > m.get(text)) m.set(text, f);
  }
}
parse("wubi86_official.dict.yaml"); parse("wubi86_jidian.dict.yaml");

const FULL_TOP = 1500;
// 每字最佳4码行
const best4 = {};
groups.forEach((m, code) => { if (code.length === 4) m.forEach((f, t) => {
  if (!best4[t] || f > best4[t].f) best4[t] = { code, f };
}); });
const topChars = Object.keys(best4).sort((a, b) => best4[b].f - best4[a].f).slice(0, FULL_TOP);
const topSet = new Set(topChars);

let maxF = 1;
groups.forEach(m => m.forEach(f => { maxF = Math.max(maxF, f || 0); }));
const lines = [];
let nShort = 0, nFull = 0;
[...groups.keys()].sort().forEach(code => groups.get(code).forEach((f, t) => {
  if (code.length < 4) { lines.push(code + " " + t); nShort++; }
  else if (topSet.has(t) && best4[t].code === code) { lines.push(code + " " + t); nFull++; }
}));
const wv = () => 100;   // 端侧单字权重统一（排序主要靠简码/云端），保持行格式紧凑
const raw = lines.map(l => l + " " + wv());
const header = "// 端侧极简：简码全留+全码top" + FULL_TOP + "；其余单字/词组云端按需加载，离线降级。\nwindow.WUBI_RAW = [\n";
const builder = "\n];\nwindow.WUBI_INDEX = (function () {\n  var idx = {};\n" +
"  window.WUBI_RAW.forEach(function (line) {\n" +
"    var p = line.split(' '), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(' ');\n" +
"    (idx[code] = idx[code] || []).push({ t: t, f: f }); });\n  return idx;\n})();\n";
fs.writeFileSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js",
  header + raw.map(x => '"' + x + '"').join(",\n") + builder);
console.log("简码行:", nShort, " 全码行:", nFull, " 总:", nShort + nFull,
  " 大小:", (fs.statSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js").size / 1024).toFixed(0) + "KB");
