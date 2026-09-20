// 生成端侧 data_wubi.js —— 严格遵循端云分层架构
// 端侧：简体单字 + 二字词 + 三/四/五字词（紧凑、parse 快、键盘秒弹）
// 自定义：custom_phrases.txt 高频口语/问候/歇后语，按五笔词组规则自动生成编码
// 用法：node tools/gen_wubi_data.js （需 npm i opencc-js）
const fs = require("fs");
const path = require("path");
const OpenCC = require("opencc-js");
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const GSC = new Set(fs.readFileSync(path.join(__dirname, "gsc_8105.txt"), "utf8"));   // 通用规范汉字8105白名单

const SRC = path.join(__dirname, "wubi86_jidian.dict.yaml");
const CUSTOM = path.join(__dirname, "custom_phrases.txt");
const OUT = path.join(__dirname, "..", "app", "src", "main", "assets", "web", "data_wubi.js");
const lines = fs.readFileSync(SRC, "utf8").split("\n");
const start = lines.indexOf("...");

// 端侧分组；单字全码
const groups = new Map();
const fullCode = {};   // 单字全码（取最长编码），用于生成自定义短语编码
let cloud = { 3: 0, 4: 0, long: 0 };
let stats = { total: 0, trad: 0, offlist: 0, kept: 0, custom: 0, customSkip: 0 };

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
  var allInGsc = [...text].every(ch => GSC.has(ch));
  if (!allInGsc) {
    if (t2s(text) !== text) { stats.trad++; continue; }   // 白名单外且为繁体
    stats.offlist++; continue;                            // 白名单外生僻/异体
  }
  // 全部字在《通用规范汉字表》即规范简体，直接保留（白名单优先，规避 opencc 误转，如“么”被误转为“幺”）
  if (len === 1 && (!fullCode[text] || code.length > fullCode[text].length)) fullCode[text] = code;
  if (len >= 3) { if (len === 3) cloud[3]++; else if (len === 4) cloud[4]++; else cloud.long++; }
  if (!groups.has(code)) groups.set(code, []);
  const arr = groups.get(code);
  if (!arr.some(x => x.t === text)) { arr.push({ t: text, len }); stats.kept++; }
}

// 权重：单字 > 二字 > 三字 > 四字…；同层按词库顺序（dict 已 by_weight）
const BASE = { 1: 100000000, 2: 1000000, 3: 10000, 4: 100, 5: 1 };

/* 自定义高频口语 / 问候 / 歇后语：按五笔词组规则生成编码，同字数里高权重靠前 */
function phraseCode(phrase) {
  var chars = [...phrase];
  var fc = function (i) { return fullCode[chars[i]] || ""; };
  if (chars.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (chars.length === 3) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 2);
  if (chars.length === 4) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(3).slice(0, 1);
  return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(chars.length - 1).slice(0, 1);
}
if (fs.existsSync(CUSTOM)) {
  fs.readFileSync(CUSTOM, "utf8").split("\n").forEach(function (raw0) {
    var phrase = raw0.trim();
    if (!phrase) return;
    var chars = [...phrase];
    if (!chars.every(function (ch) { return fullCode[ch]; })) { stats.customSkip++; return; }
    var code = phraseCode(phrase);
    if (!/^[a-y]{4}$/.test(code)) { stats.customSkip++; return; }
    if (!groups.has(code)) groups.set(code, []);
    var arr = groups.get(code);
    if (!arr.some(function (x) { return x.t === phrase; })) {
      arr.push({ t: phrase, len: chars.length, w: (BASE[chars.length] || 1) + 6000 });
      stats.custom++;
    }
  });
}

const codes = [...groups.keys()].sort();
const raw = [];
for (const code of codes) {
  const arr = groups.get(code).sort((a, b) => a.len - b.len);
  const seen = {};
  for (const e of arr) {
    const n = (seen[e.len] = (seen[e.len] || 0) + 1);
    const w = (e.w != null) ? e.w : ((BASE[e.len] || 1) - n);
    raw.push(code + " " + e.t + " " + w);
  }
}

const header =
"// 五笔86端侧码表，源：KyleBing/rime-wubi86-jidian 极点五笔 (Apache-2.0)，参考 rime/rime-wubi (LGPL-3.0)\n" +
"// 端侧含 简体单字 + 二字词 + 三字/四字/五字词 + 自定义口语；用户词、超长句与跨设备同步走云端。\n" +
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
console.log("原始:", stats.total, " 繁体剔除:", stats.trad, " 表外剔除:", stats.offlist);
console.log("端侧词条:", stats.kept, " 编码组数:", codes.length);
console.log("自定义短语加入:", stats.custom, " 跳过(缺字/编码):", stats.customSkip);
console.log("待云端导入 → 三字词:", cloud[3], " 四字词:", cloud[4], " 五字以上:", cloud.long);
console.log("输出:", (fs.statSync(OUT).size / 1024).toFixed(0) + "KB");
