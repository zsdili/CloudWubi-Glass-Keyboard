// 生成端侧 data_wubi.js —— 多源融合 · 精准红线 · 来源可审计（v2.9）
// 单字/简码 = 五笔86原方案；词组 = 多源真实语料（jieba高频 + 成语 + 歇后语谜底 + 日常口语），离线按五笔取码生成。
// 运行时零造词；每个输出词都有真实语料佐证（情境支持），无证据的字符串不产生。
const fs = require("fs");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));
const OUT = "CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js";
const FREQ_MIN = 10, MAX_LEN = 16;

// ---------- 单字/简码（86原方案）----------
const groups = new Map();   // code -> Map(text -> 86词频)
const fullCode = {};
function parse86(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t");
    if (p.length < 2) continue;
    const text = p[0].trim(), code = p[1].trim();
    const f = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if (!text || !code || !/^[a-y]{1,4}$/.test(code)) continue;
    if ([...text].length !== 1 || !GSC.has(text)) continue;
    if (!groups.has(code)) groups.set(code, new Map());
    const m = groups.get(code);
    if (!m.has(text)) m.set(text, f);
    else if (f > m.get(text)) m.set(text, f);
    if (!fullCode[text] || code.length > fullCode[text].length) fullCode[text] = code;
  }
}
parse86("wubi86_official.dict.yaml");
parse86("wubi86_jidian.dict.yaml");

// ---------- 词组容器 ----------
const phrases = new Map();   // code -> Map(text -> 原始权重)
function phraseCode(phrase) {
  const ch = [...phrase], fc = i => fullCode[ch[i]] || "";
  if (ch.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (ch.length === 3) return fc(0)[0] + fc(1)[0] + fc(2).slice(0, 2);
  if (ch.length === 4) return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(3)[0];
  return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(ch.length - 1)[0];
}
function addPhrase(text, w) {
  const ch = [...text];
  if (ch.length < 2 || ch.length > MAX_LEN || !ch.every(c => fullCode[c])) return false;
  const code = phraseCode(text);
  if (!/^[a-y]{4}$/.test(code)) return false;
  if (!phrases.has(code)) phrases.set(code, new Map());
  const m = phrases.get(code);
  if (!m.has(text) || w > m.get(text)) m.set(text, w);
  return true;
}

// ---------- 过滤系统（精准红线 + 高频保护 + 整词豁免）----------
const RAW = new Set();
fs.readFileSync("blacklist_raw.txt", "utf8").split("\n").forEach(l => { l = l.trim(); if (l) RAW.add(l); });
// TOPIC：话题红线（均为≥2字词，子串匹配；不含节日/人民等生活词）
const TOPIC = new Set([
  // 政治/国家/政策
  "政府","政策","政治","政权","政党","政务","政界","政坛","选举","主席","总统","总理","外交","主权","领土","议会","国会",
  "官员","制度","革命","共产党","国民党","社会主义","资本主义","马克思","列宁","统治","专政","方针","官僚","共和","王国","帝国",
  "中共","中央","人大","民主","共产","主义","书记","两会","公安","政协","常委","国务院","民国","法院","法治","法制","文革",
  "大跃进","人民公社","人民代表大会","辛亥革命","抗日","苏维埃","罢工","集会","游行","示威","弹劾","推翻","独裁","间谍",
  "检察","法庭","司法","监狱","警察","武警","国防部","朝代","反动派","政变","党代会",
  // 宗教
  "宗教","佛教","佛祖","佛像","道教","道士","道观","基督教","天主教","伊斯兰教","穆斯林","喇嘛","和尚","尼姑","菩萨",
  "教堂","教会","寺庙","寺院","庙宇","圣经","古兰经","佛经","祈祷","礼拜","祷告","真主","上帝","天主","法师","住持","方丈",
  "开光","烧香","拜佛","神像","供奉","图腾","教徒","圣母","基督","太监","天皇","修炼","邪教","法轮","传教","袈裟","神仙",
  // 战争/军事
  "战争","战役","战场","战斗","战士","战机","军舰","武器","兵器","枪支","枪械","弹药","导弹","炮弹","子弹","坦克","大炮",
  "军队","军方","军事","军人","士兵","军官","开战","宣战","参战","抗战","核武","军备","武装","兵力","战线","交战","战火",
  "部队","军区","军用","军警","兵团","解放军","新四军","八路军","红军","日军","机枪","步枪","手枪","火药","炸药","炸弹",
  "刺刀","原子弹","核武器","弹头","激战","屠杀","杀人","杀伤","杀手","死刑","伤亡","尸体","暴力","暴动","侵略",
  "打倒","报仇","围攻","抗议","封锁","压制","压迫","迫害","流亡","亡国","野战",
  // 民族/种族
  "民族","种族","汉族","汉人","藏族","维吾尔","回族","壮族","满族","苗族","彝族","蒙古族","少数民族","人种",
  // 封建迷信民俗（正常节日不在此列）
  "算命","占卜","风水","八字","生肖","属相","农历","祭祖","庙会","春联","年画","拜年","鞭炮",
  // 黄赌毒/脏话/消极
  "赌博","赌场","六合彩","海洛因","冰毒","大麻","摇头丸","贩毒","吸毒","制毒","毒品","毒药","鸦片",
  "自杀","自残","轻生","厌世","想死","寻死","绝望","崩溃","子宫","阴道","月经","乳房","屁股","高潮",
  "性交","交配","卖淫","嫖娼","妓女","婊子","情色","色情","黄色","成人","小姐","裸体","肛门","诅咒",
  "魔鬼","魔教","流氓","变态","凌辱","性病","肿瘤","癌症","性器官","色情片","他妈的","傻逼","草泥马","王八蛋"
]);
const ALLOW = new Set(["国庆","国庆节"]);   // 整词精确豁免（最高优先）
const HIGH_FREQ = 500;
function hitSet(w, set) {   // 只枚举≥2字子串（忽略单字因子，防"操作/日期"类单字误伤）
  const L = [...w].length;
  for (let i = 0; i < L; i++) for (let j = i + 2; j <= L; j++)
    if (set.has(w.slice(i, j))) return true;
  return false;
}
// JF：jieba 真实词频（独立语料，用于反向审计 RAW 这个"魔法"本身）
const JF = {};
fs.readFileSync("modern_words.txt", "utf8").split("\n").forEach(l => {
  const p = l.split(" "); if (p.length >= 2) JF[p[0]] = parseInt(p[1]) || 0;
});
// FACTOR_ALLOW：RAW 的"假阳性因子"——该因子本身是 jieba 高频正常词(≥FACTOR_GOOD)且不在手工红线 TOPIC，则该因子不生效。
const FACTOR_GOOD = 100;
const FACTOR_ALLOW = new Set();
RAW.forEach(f => { if ((JF[f] || 0) >= FACTOR_GOOD && !hitSet(f, TOPIC)) FACTOR_ALLOW.add(f); });
function rejected(w, jf, trusted) {
  if (ALLOW.has(w)) return false;
  if (hitSet(w, TOPIC)) return true;     // 手工红线：子串（因子经精选，含之即该删）
  if (trusted) return false;             // 经典可信语料（成语/歇后语/口语）不受 RAW 误伤
  if (FACTOR_ALLOW.has(w)) return false; // RAW 假阳性整词（经 jieba 高频审计为正常词）
  if (jf >= HIGH_FREQ) return false;
  return RAW.has(w);                     // 第三方 RAW：仅整词精确，不做子串连带
}

// ---------- 多源加入（每个词都有真实语料佐证）----------
const stat = { jieba: 0, idiom: 0, xhy: 0, spoken: 0, rej: 0 };
fs.readFileSync("modern_words.txt", "utf8").split("\n").forEach(l => {
  const p = l.split(" "); if (p.length < 2) return;
  const text = p[0], jf = parseInt(p[1]) || 0;
  if (!/^[\u4e00-\u9fff]{2,}$/.test(text) || jf < FREQ_MIN) return;
  if (rejected(text, jf)) { stat.rej++; return; }
  if (addPhrase(text, jf)) stat.jieba++;
});
JSON.parse(fs.readFileSync("xh_idiom.json", "utf8")).forEach(o => {
  const text = (o.word || "").replace(/[^\u4e00-\u9fff]/g, "");
  if (text.length < 2) return;
  if (rejected(text, 0, true)) { stat.rej++; return; }
  if (addPhrase(text, 30)) stat.idiom++;
});
JSON.parse(fs.readFileSync("xh_xiehouyu.json", "utf8")).forEach(o => {
  (o.answer || "").split(/[；;，,]/).forEach(a => {
    const text = a.replace(/[^\u4e00-\u9fff]/g, "");
    if (text.length < 2 || text.length > 6) return;
    if (rejected(text, 0, true)) return;
    if (addPhrase(text, 20)) stat.xhy++;
  });
});
fs.readFileSync("daily_spoken.txt", "utf8").split("\n").forEach(l => {
  const text = l.trim().replace(/[^\u4e00-\u9fff]/g, "");
  if (text.length < 2) return;
  if (rejected(text, 0, true)) { stat.rej++; return; }
  if (addPhrase(text, 40)) stat.spoken++;
});

// ---------- 权重归一化（单字、词组各自映射 1~1e7；前端按字数分区，不跨类比）----------
let maxSingle = 1, maxWord = 1;
groups.forEach(m => m.forEach(f => { maxSingle = Math.max(maxSingle, f || 0); }));
phrases.forEach(m => m.forEach(w => { maxWord = Math.max(maxWord, w || 0); }));
const byLen = {};
const lines = [];
const allCodes = new Set([...groups.keys(), ...phrases.keys()]);
[...allCodes].sort().forEach(code => {
  (groups.get(code) || new Map()).forEach((f, t) => {
    const wv = Math.max(1, Math.round((f / maxSingle) * 1e7));
    lines.push(code + " " + t + " " + wv); byLen[1] = (byLen[1] || 0) + 1;
  });
  (phrases.get(code) || new Map()).forEach((w, t) => {
    const wv = Math.max(1, Math.round((w / maxWord) * 1e7));
    const L = [...t].length;
    lines.push(code + " " + t + " " + wv); byLen[L] = (byLen[L] || 0) + 1;
  });
});

const header =
"// 五笔86端侧码表（多源融合 v2.9）：单字/简码=五笔86原方案；词组=jieba高频+成语+歇后语+日常口语，离线取码、过红线。\n" +
"// 运行时零造词；每个词都有真实语料佐证（情境支持），无证据不输出；宁可漏词，不可违规。\n" +
"window.WUBI_RAW = [\n";
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
fs.writeFileSync(OUT, header + lines.map(x => '"' + x + '"').join(",\n") + builder);
console.log("来源统计:", JSON.stringify(stat));
console.log("端侧按字数:", JSON.stringify(byLen));
console.log("输出:", (fs.statSync(OUT).size / 1024).toFixed(0) + "KB");
