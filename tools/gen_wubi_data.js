// 生成端侧 data_wubi.js —— 多源合并 + 真实词频 + 动态造词兜底
// 主源：rime/rime-wubi 官方 wubi86（真实大词频、排序准）；补充：极点 jidian（官方缺漏的词）
// 端侧：规范简体单字 + 二字词 + 三~五字词；漏词/新词由前端「动态造词」按五笔取码规则实时拼出。
const fs = require("fs");
const OpenCC = require("opencc-js");
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));   // 通用规范汉字8105白名单（按 code point）

const OUT = "CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js";
const SOURCES = [
  { file: "wubi86_official.dict.yaml", pri: 0 },   // 官方，主源（真实词频）
  { file: "wubi86_jidian.dict.yaml", pri: 1 },     // 极点，补充
];

const groups = new Map();   // code -> Map(text -> {len,f,src})
const fullCode = {};       // 单字全码（最长），供自定义短语编码
let stats = { trad: 0, offlist: 0 };

function parseYaml(s) {
  const lines = fs.readFileSync(s.file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t");
    if (p.length < 2) continue;
    const text = p[0].trim(), code = p[1].trim();
    const f = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if (!text || !code) continue;
    if (!/^[a-y]{1,4}$/.test(code)) continue;
    const len = [...text].length;
    if (len < 1 || len > 10) continue;
    if (![...text].every(ch => GSC.has(ch))) {
      if (t2s(text) !== text) { stats.trad++; continue; }   // 繁体
      stats.offlist++; continue;                           // 表外生僻
    }
    if (!groups.has(code)) groups.set(code, new Map());
    const m = groups.get(code);
    if (!m.has(text)) m.set(text, { len: len, f: f, src: s.pri });
    else { const e = m.get(text); if (s.pri < e.src || (s.pri === e.src && f > e.f)) { e.f = f; e.src = s.pri; } }
    if (len === 1 && (!fullCode[text] || code.length > fullCode[text].length)) fullCode[text] = code;
  }
}
SOURCES.forEach(parseYaml);

/* 自定义高频口语 / 问候 / 歇后语：按五笔词组规则生成编码，同字数高权重靠前 */
function phraseCode(phrase) {
  var chars = [...phrase];
  var fc = function (i) { return fullCode[chars[i]] || ""; };
  if (chars.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (chars.length === 3) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 2);
  if (chars.length === 4) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(3).slice(0, 1);
  return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(chars.length - 1).slice(0, 1);
}
let customN = 0, customSkip = 0;
if (fs.existsSync("custom_phrases.txt")) {
  fs.readFileSync("custom_phrases.txt", "utf8").split("\n").forEach(function (raw0) {
    var phrase = raw0.trim();
    if (!phrase) return;
    var chars = [...phrase];
    if (!chars.every(ch => fullCode[ch])) { customSkip++; return; }
    var code = phraseCode(phrase);
    if (!/^[a-y]{4}$/.test(code)) { customSkip++; return; }
    if (!groups.has(code)) groups.set(code, new Map());
    var m = groups.get(code);
    if (!m.has(phrase)) { m.set(phrase, { len: chars.length, f: 0, src: 0, custom: true }); customN++; }
  });
}

// 按字数归一化真实词频到 1 ~ 1e7（同字数内保留相对高低；recent 1e9 仍最高）
const maxByLen = {};
groups.forEach(m => m.forEach(e => { if (!e.custom && e.f > (maxByLen[e.len] || 0)) maxByLen[e.len] = e.f; }));
const SCALE = 1e7;
const codes = [...groups.keys()].sort();
const raw = [];
let totalEntries = 0, byLen = {};
for (const code of codes) {
  const arr = [...groups.get(code).entries()].map(([t, e]) => ({ t: t, len: e.len, custom: e.custom, f: e.f }));
  arr.forEach(e => {
    e.f = e.custom ? Math.round(SCALE * 1.08) : Math.max(1, Math.round((e.f / (maxByLen[e.len] || 1)) * SCALE));
  });
  arr.sort((a, b) => a.len - b.len || b.f - a.f);
  for (const e of arr) {
    raw.push(code + " " + e.t + " " + e.f);
    totalEntries++; byLen[e.len] = (byLen[e.len] || 0) + 1;
  }
}

const header =
"// 五笔86端侧码表（多源合并）：rime/rime-wubi 官方 (LGPL-3.0) + KyleBing/rime-wubi86-jidian 极点 (Apache-2.0)\n" +
"// 端侧含规范简体单字 + 二字词 + 三~五字词（真实词频排序）；漏词/新词由前端动态造词实时拼出，用户词跨设备同步走云端。\n" +
"window.WUBI_RAW = [\n";
const rawStr = raw.map(x => '"' + x + '"').join(",\n");
const builder =
"\n];\n" +
"// 紧凑构建索引（量级可控，启动期阻塞极短）\n" +
"window.WUBI_INDEX = (function () {\n" +
"  var idx = {};\n" +
"  window.WUBI_RAW.forEach(function (line) {\n" +
"    var p = line.split(' '), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(' ');\n" +
"    (idx[code] = idx[code] || []).push({ t: t, f: f });\n" +
"  });\n" +
"  return idx;\n" +
"})();\n";

fs.writeFileSync(OUT, header + rawStr + builder);
console.log("繁体剔除:", stats.trad, " 表外剔除:", stats.offlist);
console.log("总词条:", totalEntries, " 按字数:", JSON.stringify(byLen), " 编码组数:", codes.length);
console.log("自定义短语:", customN, " 跳过:", customSkip);
console.log("输出:", (fs.statSync(OUT).size / 1024).toFixed(0) + "KB");
