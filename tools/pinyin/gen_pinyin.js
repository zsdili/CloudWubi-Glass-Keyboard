const fs = require('fs');
const { pinyin } = require('pinyin-pro');
const complete = require('@pinyin-pro/data/complete');

// kMandarin 规范读音
const km = {};
for (const line of fs.readFileSync('pinyin-data/kMandarin.txt', 'utf8').split('\n')) {
  const m = line.match(/^U\+([0-9A-F]+):\s*(.+?)\s*#/);
  if (!m) continue;
  km[parseInt(m[1], 16)] = m[2].split(/[,，]\s*/).flatMap(x => x.split(/\s+/)).filter(Boolean);
}
function strip(s) {
  const map = { ā:'a',á:'a',ǎ:'a',à:'a', ē:'e',é:'e',ě:'e',è:'e',
    ī:'i',í:'i',ǐ:'i',ì:'i', ō:'o',ó:'o',ǒ:'o',ò:'o',
    ū:'u',ú:'u',ǔ:'u',ù:'u', ǖ:'v',ǘ:'v',ǚ:'v',ǜ:'v' };
  return s.replace(/[āáǎàēéěèīíǐìōóǒòūúǔùǖǘǚǜ]/g, c => map[c]).replace(/ü/g, 'v');
}

// 收集五笔字、词（统一两种分片格式）
const chars = new Map(), words = new Map();
function add(t, f) {
  f = f || 0;
  if (t.length === 1) { if (!chars.has(t) || f > chars.get(t)) chars.set(t, f); }
  else { if (!words.has(t) || f > words.get(t)) words.set(t, f); }
}
const liteDir = '../CloudWubiKeyboard/app/src/main/assets/web/lite';
for (const fn of fs.readdirSync(liteDir)) {
  if (!fn.endsWith('.json')) continue;
  const o = JSON.parse(fs.readFileSync(liteDir + '/' + fn, 'utf8'));
  for (const code in o) for (const e of o[code]) add(e.t, e.f);
}
for (const fn of fs.readdirSync('../cloud')) {
  if (!fn.endsWith('.json')) continue;
  const o = JSON.parse(fs.readFileSync('../cloud/' + fn, 'utf8'));
  for (const code in o) for (const e of o[code]) add(e[0], e[1]);
}

const pySyl = {}, pyFull = {}, pyJian = {};
// 单字：全读音并集，主音标记
for (const [ch, f] of chars) {
  let reads = [];
  try { reads = pinyin(ch, { multiple: true, type: 'array' }); } catch (e) {}
  const syls = new Set(reads.map(strip));
  (km[ch.codePointAt(0)] || []).forEach(x => syls.add(strip(x)));
  const main = complete[ch] ? strip(complete[ch][0].split(' ')[0]) : null;
  const fFreq = complete[ch] ? Math.round(complete[ch][1] * 1e10) : 0;
  syls.forEach(s => {
    if (!/^[a-zv]+$/.test(s)) return;
    (pySyl[s] = pySyl[s] || []).push({ t: ch, f: fFreq, main: s === main ? 1 : 0 });
  });
}
// 词：全拼 + 简拼
let skipped = 0;
for (const [w, f] of words) {
  let arr;
  if (complete[w]) arr = complete[w][0].split(' ');
  else { try { arr = pinyin(w, { toneType: 'none', type: 'array' }); } catch (e) { arr = []; } }
  arr = arr.map(strip);
  if (arr.some(x => !/^[a-zv]+$/.test(x))) { skipped++; continue; }
  const wf = complete[w] ? Math.round(complete[w][1] * 1e10) : 1;
  const full = arr.join(''), jian = arr.map(s => s[0]).join('');
  (pyFull[full] = pyFull[full] || []).push({ t: w, f: wf });
  (pyJian[jian] = pyJian[jian] || []).push({ t: w, f: wf });
}
// 符号 / 表情：拼音（全拼+简拼）同样可带出
const SYMBOL_WORDS = [
  { w: "加", out: "＋" }, { w: "减", out: "－" }, { w: "乘", out: "×" }, { w: "除", out: "÷" },
  { w: "等于", out: "＝" }, { w: "等号", out: "＝" }, { w: "括号", out: "（）" },
  { w: "百分之", out: "％" }, { w: "千分之", out: "‰" },
  { w: "大于", out: "＞" }, { w: "小于", out: "＜" }, { w: "不等于", out: "≠" },
  { w: "笑", out: "😊" }, { w: "哭", out: "😭" }, { w: "爱", out: "❤" }, { w: "心", out: "❤" },
  { w: "花", out: "🌸" }, { w: "星", out: "⭐" }, { w: "火", out: "🔥" }, { w: "水", out: "💧" },
  { w: "太阳", out: "☀" }, { w: "月亮", out: "🌙" }, { w: "赞", out: "👍" }
];
for (const sw of SYMBOL_WORDS) {
  let arr;
  try { arr = pinyin(sw.w, { toneType: 'none', type: 'array' }); } catch (e) { arr = []; }
  arr = arr.map(strip);
  if (arr.some(x => !/^[a-zv]+$/.test(x))) continue;
  const full = arr.join(''), jian = arr.map(s => s[0]).join('');
  (pyFull[full] = pyFull[full] || []).push({ t: sw.out, f: 0, sym: 1 });
  (pyJian[jian] = pyJian[jian] || []).push({ t: sw.out, f: 0, sym: 1 });
}
for (const s in pySyl) pySyl[s].sort((a, b) => b.main - a.main || b.f - a.f);
for (const k in pyFull) pyFull[k].sort((a, b) => b.f - a.f);
for (const k in pyJian) pyJian[k].sort((a, b) => b.f - a.f);

fs.writeFileSync('pygen_syl.json', JSON.stringify(pySyl));
fs.writeFileSync('pygen_full.json', JSON.stringify(pyFull));
fs.writeFileSync('pygen_jian.json', JSON.stringify(pyJian));
const sz = n => (fs.statSync(n).size / 1024).toFixed(0) + 'KB';
console.log(JSON.stringify({
  chars: chars.size, words: words.size, skipped,
  syllables: Object.keys(pySyl).length,
  fullKeys: Object.keys(pyFull).length,
  jianKeys: Object.keys(pyJian).length,
  size: { syl: sz('pygen_syl.json'), full: sz('pygen_full.json'), jian: sz('pygen_jian.json') }
}, null, 1));
