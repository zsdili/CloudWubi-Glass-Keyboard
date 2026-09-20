// 生成端侧 data_wubi.js —— 边界优先（v2.8）
// 【边界1】单字/一~四级简码完全保留五笔86原方案，词组逻辑不改动单字映射。
// 【边界2/3】词组唯一来源：规范现代汉语白名单（jieba 高频纯中文词），离线按五笔取码规则生成，零杂质。
// 【边界4/5/6】白名单词再过违禁/低俗/消极黑名单（枚举子串匹配），只输出合法、公序良俗、积极阳光的词。
const fs = require("fs");
const OpenCC = require("opencc-js");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));   // 通用规范汉字8105
const OUT = "CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js";
const FREQ_MIN = 10;        // 白名单词频下限（剔除长尾生造）
const MAX_LEN = 10;

// RAW：第三方大词表（假阳性高，仅用于"低频词"的违禁/脏词过滤）
const RAW = new Set();
fs.readFileSync("blacklist_raw.txt", "utf8").split("\n").forEach(l => { l = l.trim(); if (l) RAW.add(l); });
// TOPIC：话题红线（手工精确定义，所有词频都过滤、不豁免）——国家/政策/政治/宗教/战争/民族/民俗及黄赌毒脏话
const TOPIC = new Set([
  // 政治/国家/政策
  "国家","政府","政策","政治","政权","政党","政务","政界","政坛","选举","主席","总统","总理","外交","主权","领土",
  "议会","国会","官员","官僚","制度","革命","共产党","国民党","社会主义","资本主义","马克思","列宁","方针","统治","专政","共和","王国","帝国",
  // 宗教
  "宗教","教堂","教会","教派","信徒","寺庙","寺院","庙宇","菩萨","和尚","尼姑","道士","道观","圣经","古兰经","佛经","祈祷","礼拜",
  "祷告","真主","上帝","天主","基督教","天主教","佛教","道教","伊斯兰教","穆斯林","法师","住持","方丈","开光","烧香","拜佛","神像","供奉","图腾",
  // 战争/军事
  "战争","战役","战场","战斗","战士","战机","军舰","武器","兵器","枪支","枪械","弹药","导弹","炮弹","子弹","坦克","大炮",
  "军队","军方","军事","军人","士兵","军官","开战","宣战","参战","抗战","核武","军备","武装","兵力","战线","交战","战火",
  // 民族/种族
  "民族","种族","汉族","汉人","藏族","维吾尔","回族","壮族","满族","苗族","彝族","蒙古族","少数民族","人种",
  // 民俗
  "民俗","风俗","习俗","春节","过年","新年","端午","中秋","清明","庙会","算命","占卜","风水","八字","生肖","属相","农历","节气","祭祖","拜年","鞭炮","春联","年画",
  // 政治补充（机构/人物/事件/术语）
  "中国","中共","中央","中华","人民","人大","民主","共产","主义","书记","两会","公安","天安门","政协","常委","国务院","国民","民国",
  "法院","法治","法制","法西斯","文革","毛主席","大跃进","人民公社","辛亥革命","抗日","国共合作","国民政府","北洋政府","清政府",
  "苏维埃","新民主主义","无产阶级","反攻","反共","反革命","右派","汉奸","政变","造反","镇压","罢工","集会","游行","示威","请愿",
  "弹劾","推翻","独裁","间谍","情报","检察","法庭","司法","监狱","警察","警官","武警","总书记","国防部","军委","党","朝代",
  // 宗教补充
  "佛祖","佛像","喇嘛","圣母","圣水","基督","唐僧","太监","天皇","修炼","邪教","法轮","传教","袈裟","神仙",
  // 战争/军事补充
  "部队","军区","军用","军警","兵团","解放军","新四军","八路军","红军","日军","机枪","步枪","手枪","火药","炸药","炸弹",
  "刺刀","匕首","原子弹","核武器","核潜艇","弹头","激战","屠杀","杀人","杀伤","杀手","杀死","死刑","伤亡","尸体",
  "暴力","暴动","侵略","打倒","报仇","征服","围攻","抗议","封锁","压制","压迫","迫害","流亡","亡国","分裂","野战",
  // 民族/民俗补充
  "红包","元宵","重阳","腊八","朝鲜族","内蒙古","西藏","拉萨","自治区",
  // 黄赌毒/脏话/消极（R6）
  "自杀","自残","轻生","厌世","想死","寻死","绝望","崩溃","同归于尽","艾滋病","残疾","死亡","子宫","阴道","月经","乳房",
  "屁股","高潮","性交","交配","卖淫","嫖娼","妓女","婊子","情色","色情","黄色","成人","小姐","裸体","肛门","诅咒",
  "魔鬼","魔教","流氓","变态","凌辱","性病","肿瘤","癌症","毒品","毒药","海洛因","冰毒","大麻","摇头丸","鸦片",
  "赌博","赌场","六合彩","吸毒","贩毒","制毒","性器官","色情片","他妈的","傻逼","草泥马","王八蛋"
]);
const HIGH_FREQ = 500;   // 高频常用词保护阈值（豁免 RAW 误伤；TOPIC 不豁免）
function hitSet(w, set) {
  const L = [...w].length;
  for (let i = 0; i < L; i++) for (let j = i + 1; j <= L; j++)
    if (set.has(w.slice(i, j))) return true;
  return false;
}
function isRejected(w, jf) {
  if (hitSet(w, TOPIC)) return true;          // 话题红线，不豁免
  if (jf >= HIGH_FREQ) return false;          // 高频常用词：豁免 RAW 误伤（真违禁词不会高频）
  return hitSet(w, RAW);                       // 低频词：过完整大词表（宁漏）
}

const groups = new Map();   // code -> Map(text -> {len, f单字86, jf词组白名单})
const fullCode = {};        // 单字全码（供词组编码）

// ---- 1) 五笔86 单字/简码（原方案，只取单字，规范简体）----
function parse86(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t");
    if (p.length < 2) continue;
    const text = p[0].trim(), code = p[1].trim();
    const f = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if (!text || !code || !/^[a-y]{1,4}$/.test(code)) continue;
    if ([...text].length !== 1 || !GSC.has(text)) continue;   // 仅单字、规范简体
    if (!groups.has(code)) groups.set(code, new Map());
    const m = groups.get(code);
    if (!m.has(text)) m.set(text, { len: 1, f: f });
    else if (f > m.get(text).f) m.get(text).f = f;
    if (!fullCode[text] || code.length > fullCode[text].length) fullCode[text] = code;
  }
}
parse86("wubi86_official.dict.yaml");
parse86("wubi86_jidian.dict.yaml");

// ---- 2) 规范白名单词组（jieba 高频、纯中文、过黑名单），按五笔取码规则生成编码 ----
function phraseCode(phrase) {
  const chars = [...phrase], fc = i => fullCode[chars[i]] || "";
  if (chars.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (chars.length === 3) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 2);
  if (chars.length === 4) return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(3).slice(0, 1);
  return fc(0).slice(0, 1) + fc(1).slice(0, 1) + fc(2).slice(0, 1) + fc(chars.length - 1).slice(0, 1);
}
let wn = 0, skip = 0, wblack = 0;
fs.readFileSync("modern_words.txt", "utf8").split("\n").forEach(l => {
  const p = l.split(" ");
  if (p.length < 2) return;
  const text = p[0], jf = parseInt(p[1]) || 0;
  if (!/^[\u4e00-\u9fff]{2,}$/.test(text) || jf < FREQ_MIN) return;
  const chars = [...text];
  if (chars.length > MAX_LEN) return;
  if (!chars.every(ch => fullCode[ch])) { skip++; return; }
  if (isRejected(text, jf)) { wblack++; return; }
  const code = phraseCode(text);
  if (!/^[a-y]{4}$/.test(code)) { skip++; return; }
  if (!groups.has(code)) groups.set(code, new Map());
  const m = groups.get(code);
  if (!m.has(text)) { m.set(text, { len: chars.length, jf: jf }); wn++; }
  else { const e = m.get(text); if ((e.jf || 0) < jf) e.jf = jf; }
});

// ---- 3) 权重归一化（单字按86词频、词组按白名单词频，各自映射 1~1e7；前端按字数分区排序，不跨类比）----
const SCALE = 1e7;
let maxSingle = 1, maxWord = 1;
groups.forEach(m => m.forEach(e => {
  if (e.len === 1) maxSingle = Math.max(maxSingle, e.f || 0);
  else maxWord = Math.max(maxWord, e.jf || 0);
}));
const codes = [...groups.keys()].sort();
const raw = [];
let byLen = {};
for (const code of codes) {
  const arr = [...groups.get(code).entries()].map(([t, e]) => ({ t, len: e.len,
    f: e.len === 1 ? Math.max(1, Math.round((e.f / maxSingle) * SCALE))
                    : Math.max(1, Math.round(((e.jf || 0) / maxWord) * SCALE)) }));
  arr.sort((a, b) => a.len - b.len || b.f - a.f);
  for (const e of arr) { raw.push(code + " " + e.t + " " + e.f); byLen[e.len] = (byLen[e.len] || 0) + 1; }
}

const header =
"// 五笔86端侧码表（边界优先 v2.8）：单字/简码=五笔86原方案；词组=规范现代汉语白名单（jieba高频）按五笔取码生成，过违禁黑名单。\n" +
"// 零杂质、符合现代汉语规范、合法公序良俗、积极阳光；运行时不做无约束动态造词，临时词靠用户上屏学习。\n" +
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
console.log("大表词条:", RAW.size, " 话题红线:", TOPIC.size);
console.log("白名单词组加入:", wn, " 黑名单剔除:", wblack, " 编码缺字跳过:", skip);
console.log("端侧按字数:", JSON.stringify(byLen));
console.log("输出:", (fs.statSync(OUT).size / 1024).toFixed(0) + "KB");
