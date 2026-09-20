// 独立对照审计器（第二大脑 / 用魔法打败魔法）
// 审计对象：端侧产物 data_wubi.js。独立 parse 86、独立算编码、独立建证据库，与生成器两条路径互相印证。
const fs = require("fs");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));

// 红线词表从生成器文件提取（单一权威来源，脚本不内联）
const genSrc = fs.readFileSync("gen_wubi_data.js", "utf8");
const topicBlock = genSrc.match(/const TOPIC = new Set\(\[([\s\S]*?)\]\);/)[1];
const BAN = new Set([...topicBlock.matchAll(/"([^"]+)"/g)].map(m => m[1]));

// ---- 独立构建 fullCode ----
const fullCode = {};
function parse(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t"); if (p.length < 2) continue;
    const t = p[0].trim(), c = p[1].trim();
    if (!t || !/^[a-y]{1,4}$/.test(c) || [...t].length !== 1 || !GSC.has(t)) continue;
    if (!fullCode[t] || c.length > fullCode[t].length) fullCode[t] = c;
  }
}
parse("wubi86_official.dict.yaml"); parse("wubi86_jidian.dict.yaml");
function phraseCode(phrase) {
  const ch = [...phrase], fc = i => fullCode[ch[i]] || "";
  if (ch.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (ch.length === 3) return fc(0)[0] + fc(1)[0] + fc(2).slice(0, 2);
  if (ch.length === 4) return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(3)[0];
  return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(ch.length - 1)[0];
}

// ---- 独立证据库（情境支持）----
const EVID = new Set();
fs.readFileSync("modern_words.txt", "utf8").split("\n").forEach(l => {
  const w = l.split(" ")[0]; if (/^[\u4e00-\u9fff]{2,}$/.test(w)) EVID.add(w);
});
JSON.parse(fs.readFileSync("xh_idiom.json", "utf8")).forEach(o => {
  const w = (o.word || "").replace(/[^\u4e00-\u9fff]/g, ""); if (w.length >= 2) EVID.add(w);
});
JSON.parse(fs.readFileSync("xh_xiehouyu.json", "utf8")).forEach(o =>
  (o.answer || "").split(/[；;，,]/).forEach(a => { const w = a.replace(/[^\u4e00-\u9fff]/g, ""); if (w.length >= 2) EVID.add(w); }));
fs.readFileSync("daily_spoken.txt", "utf8").split("\n").forEach(l => {
  const w = l.trim().replace(/[^\u4e00-\u9fff]/g, ""); if (w.length >= 2) EVID.add(w);
});

function hitBAN(w) {
  const L = [...w].length;
  for (let i = 0; i < L; i++) for (let j = i + 2; j <= L; j++) if (BAN.has(w.slice(i, j))) return true;
  return false;
}

// ---- 加载端侧产物（审计对象）----
const win = {}; global.window = win;
eval(fs.readFileSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js", "utf8"));
const WUBI = win.WUBI_INDEX;
function canType(w) { const c = phraseCode(w); return (WUBI[c] || []).some(o => o.t === w); }

// ===== 审计1：正向覆盖（加持好魔法）=====
const must = [];
const jw = [];
fs.readFileSync("modern_words.txt", "utf8").split("\n").forEach(l => {
  const p = l.split(" "); if (p.length < 2) return;
  if (/^[\u4e00-\u9fff]{2,}$/.test(p[0])) jw.push([p[0], parseInt(p[1]) || 0]);
});
jw.sort((a, b) => b[1] - a[1]);
jw.slice(0, 2000).forEach(x => { if (!hitBAN(x[0])) must.push(x[0]); });
JSON.parse(fs.readFileSync("xh_idiom.json", "utf8")).forEach(o => {
  const w = (o.word || "").replace(/[^\u4e00-\u9fff]/g, "");
  if (w.length >= 2 && !hitBAN(w)) must.push(w);
});
fs.readFileSync("daily_spoken.txt", "utf8").split("\n").forEach(l => {
  const w = l.trim().replace(/[^\u4e00-\u9fff]/g, ""); if (w.length >= 2) must.push(w);
});
["人民","人民群众","国庆节","吃饭了吗","去哪了","不会吧","冰冻三尺非一日之寒","不要","什么","他们","我们","手机"].forEach(w => must.push(w));
const mustSet = new Set(must);
let cov = 0; const gaps = [];
mustSet.forEach(w => {
  if ([...w].some(c => !fullCode[c])) return;
  if (canType(w)) cov++; else gaps.push(w);
});
console.log("【审计1·正向覆盖】应能打 " + mustSet.size + "，实际 " + cov + "，覆盖率 " + (cov / mustSet.size * 100).toFixed(1) + "%");
console.log("  缺口(该有却没有) " + gaps.length + ": " + gaps.slice(0, 30).join(" / "));

// ===== 审计2：反向违规（打败坏魔法）=====
const viol = new Set();
Object.keys(WUBI).forEach(c => WUBI[c].forEach(o => { if (hitBAN(o.t)) viol.add(o.t); }));
console.log("【审计2·反向违规】输出词中违规 " + viol.size + ": " + [...viol].slice(0, 30).join(" / "));

// ===== 审计3：情境证据（防乱造）=====
const noEvid = new Set();
Object.keys(WUBI).forEach(c => WUBI[c].forEach(o => {
  if ([...o.t].length >= 2 && !EVID.has(o.t)) noEvid.add(o.t);
}));
console.log("【审计3·情境证据】无任何语料佐证(乱造嫌疑) " + noEvid.size + ": " + [...noEvid].slice(0, 30).join(" / "));

// ===== 裁决 =====
const pass = gaps.length === 0 && viol.size === 0 && noEvid.size === 0;
console.log("\n=== 对照审计裁决: " + (pass ? "PASS（零缺口/零违规/零乱造）" : "FAIL（需修复后再审）") + " ===");
