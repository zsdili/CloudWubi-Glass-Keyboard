// 生成端侧 data_wubi.js —— 由开源五笔字典可复现
// 运行：在仓库根执行 `node tools/gen_wubi_data.js`（需先 npm install opencc-js）
const fs = require("fs");
const path = require("path");
const OpenCC = require("opencc-js");
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const DIR = __dirname;
const GSC = new Set(fs.readFileSync(path.join(DIR, "gsc_8105.txt"), "utf8")); // 通用规范汉字8105白名单

const SRC = path.join(DIR, "wubi86_jidian.dict.yaml");
const OUT = path.join(DIR, "../app/src/main/assets/web/data_wubi.js");
const lines = fs.readFileSync(SRC, "utf8").split("\n");
const start = lines.indexOf("...");

const groups = new Map();
let cloud = { 3: 0, 4: 0, long: 0 };
let stats = { total: 0, trad: 0, offlist: 0, kept: 0 };

for (let i = (start < 0 ? 0 : start + 1); i < lines.length; i++) {
  const p = lines[i].split("\t");
  if (p.length < 2) continue;
  const text = p[0].trim();
  const code = p[1].trim();
  if (!text || !code) continue;
  stats.total++;
  if (!/^[a-y]{1,4}$/.test(code)) continue;
  const len = [...text].length;
  if (len < 1 || len > 10) continue;
  if (t2s(text) !== text) { stats.trad++; continue; }   // 繁体剔除
  if (![...text].every(ch => GSC.has(ch))) { stats.offlist++; continue; }  // 白名单外剔除
  if (len >= 3) { if (len === 3) cloud[3]++; else if (len === 4) cloud[4]++; else cloud.long++; }
  if (!groups.has(code)) groups.set(code, []);
  const arr = groups.get(code);
  if (!arr.some(x => x.t === text)) { arr.push({ t: text, len }); stats.kept++; }
}

// 权重：单字 > 二字 > 三字 > 四字…
const BASE = { 1: 100000000, 2: 1000000, 3: 10000, 4: 100, 5: 1 };
const codes = [...groups.keys()].sort();
const raw = [];
for (const code of codes) {
  const arr = groups.get(code).sort((a, b) => a.len - b.len);
  const seen = {};
  for (const e of arr) {
    const n = (seen[e.len] = (seen[e.len] || 0) + 1);
    raw.push(code + " " + e.t + " " + ((BASE[e.len] || 1) - n));
  }
}

const header =
"// 五笔86端侧码表，源：KyleBing/rime-wubi86-jidian 极点五笔 (Apache-2.0)，参考 rime/rime-wubi (LGPL-3.0)\n" +
"// 端侧含 简体单字 + 二字词 + 三字/四字/五字词（可直接打出）；用户词、超长句与跨设备同步走云端。\n" +
"window.WUBI_RAW = [\n";
const rawStr = raw.map(x => '"' + x + '"').join(",\n");
const builder =
"\n];\n" +
"window.WUBI_INDEX = (function () {\n" +
"  var idx = {};\n" +
"  window.WUBI_RAW.forEach(function (line) {\n" +
"    var p = line.split(' '), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(' ');\n" +
"    (idx[code] = idx[code] || []).push({ t: t, f: f });\n" +
"  });\n" +
"  return idx;\n" +
"})();\n";

fs.writeFileSync(OUT, header + rawStr + builder);
console.log("原始:", stats.total, " 繁体剔除:", stats.trad, " 表外剔除:", stats.offlist);
console.log("端侧词条:", stats.kept, " 编码组数:", codes.length);
console.log("待云端导入 → 三字词:", cloud[3], " 四字词:", cloud[4], " 五字以上:", cloud.long);
console.log("输出:", (fs.statSync(OUT).size / 1024).toFixed(0) + "KB");
