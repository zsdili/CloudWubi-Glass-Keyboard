/* ============================================================
 * 云五笔·玻璃键盘 lite v1.5
 * 事件架构：click 委托主触发（WebView 最稳）+ pointer 手势
 *   （按压视觉 / 长按弹条 / 退格连删 / 空格长按语音·横拖光标 /
 *     剪贴板长按删除）；长按触发后吞掉随后 click 防重复。
 * 功能：86五笔词库·中英混输·英文补全·Shift三态·实时计算·
 *   三栏数字键盘·光标跟随联想翻译·剪贴板·语音·主题
 * ============================================================ */
(function () {
"use strict";

/* ---------- 桥接 ---------- */
function hasBridge() {
  return !!(window.AndroidBridge && typeof window.AndroidBridge.commit === "function");
}
var B = hasBridge() ? window.AndroidBridge : null;
function bridge(f) { if (B) { try { f(B); } catch (e) { L("桥错误:" + e.message); } } }
function isApk() { return !!B; }

/* ---------- 日志环（诊断用） ---------- */
var LOG_BUF = [];
function L(m) { try { LOG_BUF.push(Date.now() + " " + m); if (LOG_BUF.length > 150) LOG_BUF.shift(); } catch (e) {} }
window.LOG = L;
window.addEventListener("error", function (e) { L("JS错误:" + e.message + " @" + (e.filename || "") + ":" + (e.lineno || "")); });

/* ---------- DOM 工具 ---------- */
function $(s, r) { return (r || document).querySelector(s); }
function $all(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
function el(tag, cls, html) {
  var e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
}

/* ---------- 音效 / 震动 / Toast ---------- */
var audioCtx = null;
function playClick() {
  if (!settings.sound) return;
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === "suspended") audioCtx.resume();
    var o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.connect(g); g.connect(audioCtx.destination);
    o.frequency.value = 520; g.gain.value = 0.018;
    o.start(); g.gain.exponentialRampToValueAtTime(0.0001, audioCtx.currentTime + 0.05);
    o.stop(audioCtx.currentTime + 0.06);
  } catch (e) {}
}
function vib(ms) { if (settings.vib) bridge(function (b) { b.vibrate(ms && ms > 0 ? ms : 18); }); }
var toastTimer = null;
function toast(msg) {
  var t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.remove(); }, 1800);
}

/* ---------- 持久化设置 / 状态 ---------- */
var DEFAULT_SETTINGS = { sug: true, trans: false, sound: true, vib: true, blur: true, theme: "" };
var settings = load("cw_settings", DEFAULT_SETTINGS);
if (settings.theme === "light") settings.theme = "";   // 旧「鲜艳果冻」归一为默认清透玻璃
var SOFT_GPU = false;   // 宿主软件GPU(SwiftShader/模拟器)：强制关背景模糊，由 Java softGpu() 探测
function load(k, def) {
  try {
    var v = JSON.parse(localStorage.getItem(k));
    if (v == null) return Array.isArray(def) ? [] : Object.assign({}, def);
    if (Array.isArray(def)) return Array.isArray(v) ? v : [];
    return Object.assign({}, def, v);
  } catch (e) { return Array.isArray(def) ? [] : Object.assign({}, def); }
}
function save(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

var state = {
  mode: "smart",        // smart(中英混输/五笔) | wubi(纯五笔) | en(英文)
  panel: "letters",
  buf: "",              // 五笔编码缓冲（英文逐字母即时上屏，不用 buf）
  enPre: "",            // 英文当前正在拼写的单词前缀（补全用）
  cands: [],
  ctxCands: [],
  calc: "",             // 数字面板算式
  lastExpr: "",
  calcDone: false,
  isPassword: false,    // 文本密码框（不联想/翻译/自动大写）
  numPassword: false,   // 数字密码框（仅数字）
  numeric: false,       // 普通数字框
  shift: "upper",       // upper（大写，默认）| lower（小写）
  before: "",           // 光标前文本（句首/联想/翻译用）
  recent: load("cw_recent", []),
  clips: load("cw_clips", []),
  lpZh: (localStorage.getItem("cw_lpZh") || "，"),
  rpZh: (localStorage.getItem("cw_rpZh") || "。"),
  lpEn: (localStorage.getItem("cw_lpEn") || ","),
  rpEn: (localStorage.getItem("cw_rpEn") || ".")
};
function isZh() { return state.mode !== "en"; }

/* ---------- 五笔数据 ---------- */
var WUBI = window.WUBI_INDEX || {};
/* ---------- 英文数据 ---------- */
var EN_RAW = window.EN_WORDS || [];
var EN_WORDS = Array.isArray(EN_RAW) ? EN_RAW : String(EN_RAW).split(/\s+/).filter(Boolean);
var EN_NEXT = window.EN_NEXT || {};
var EN_PHRASES = window.EN_PHRASES || [];
var EN_INDEX = {};   // 前缀 -> 词数组
EN_WORDS.forEach(function (w) {
  for (var i = 1; i <= w.length; i++) {
    var p = w.slice(0, i);
    if (!EN_INDEX[p]) EN_INDEX[p] = [];
    EN_INDEX[p].push(w);
  }
});

/* ---------- 联想索引（光标跟随） ---------- */
var SUG1 = {}, SUG2 = {};
function buildSug() {
  var t0 = Date.now();
  Object.keys(WUBI).forEach(function (code) {
    WUBI[code].forEach(function (o) {
      var w = o.t;
      if (WORD2CODE[w] === undefined || code.length < WORD2CODE[w].length) WORD2CODE[w] = code;
      if (w.length === 2) {
        var a = w[0], b = w[1];
        (SUG1[a] = SUG1[a] || []).push({ t: b, f: o.f });
        (SUG2[a] = SUG2[a] || {})[b] = (SUG2[a][b] || 0) + o.f;
      }
    });
  });
  L("联想索引构建 " + (Date.now() - t0) + "ms");
}
function sugFor(tail) {
  if (!settings.sug || !tail) return [];
  var c1 = tail[tail.length - 1];
  var m = {}, out = [];
  function add(w, f) { if (w && !m[w] && tail.indexOf(w) === -1) { m[w] = 1; out.push({ t: w, f: f }); } }
  var two = SUG2[c1];
  if (two) Object.keys(two).forEach(function (k) { add(c1 + k, two[k]); });
  var one = SUG1[c1];
  if (one) one.slice().sort(function (a, b) { return b.f - a.f; }).slice(0, 10).forEach(function (o) { add(o.t, o.f * 0.6); });
  return out.sort(function (a, b) { return b.f - a.f; }).slice(0, 8).map(function (o) { return o.t; });
}

/* ---------- 中文词 → 符号 / 表情（用户固化规则） ----------
 * 输入该中文词的五笔编码时，候选里同步给出对应符号/表情，点选即上屏 */
var WORD2CODE = {};
var SYMBOL_WORDS = [
  { w: "加", out: "＋" }, { w: "减", out: "－" }, { w: "乘", out: "×" }, { w: "除", out: "÷" },
  { w: "等于", out: "＝" }, { w: "等号", out: "＝" }, { w: "括号", out: "（）" },
  { w: "百分之", out: "％" }, { w: "千分之", out: "‰" },
  { w: "大于", out: "＞" }, { w: "小于", out: "＜" }, { w: "不等于", out: "≠" },
  { w: "笑", out: "😊" }, { w: "哭", out: "😭" },
  { w: "爱", out: "❤" }, { w: "心", out: "❤" },
  { w: "花", out: "🌸" }, { w: "星", out: "⭐" }, { w: "火", out: "🔥" }, { w: "水", out: "💧" },
  { w: "太阳", out: "☀" }, { w: "月亮", out: "🌙" }, { w: "赞", out: "👍" }
];

/* ---------- 五笔查询 ---------- */
function queryWubi(code) {
  var seen = {}, exact = [], prefix = [];
  function add(o, into) {
    if (!seen[o.t] && !/[㐀-䶿]/.test(o.t)) { seen[o.t] = 1; into.push({ t: o.t, f: o.f || 0 }); }
  }
  var cLen = code.length;
  if (code.indexOf("z") >= 0) {
    var re = new RegExp("^" + code.replace(/z/g, ".") + "$");
    Object.keys(WUBI).forEach(function (k) { if (re.test(k)) (WUBI[k] || []).forEach(function (o) { add(o, prefix); }); });
  } else {
    (WUBI[code] || []).forEach(function (o) { add(o, exact); });   // 精确编码（简码锚字/本码词组）
    if (cLen < 4) Object.keys(WUBI).forEach(function (k) {          // 前缀补全
      if (k !== code && k.indexOf(code) === 0) (WUBI[k] || []).forEach(function (o) { add(o, prefix); });
    });
  }
  function recentRank(t) { var ri = state.recent.indexOf(t); return ri >= 0 ? (1e9 - ri * 1000) : 0; }
  var exactSingle = exact.filter(function (o) { return o.t.length === 1; });
  var prefixSingle = prefix.filter(function (o) { return o.t.length === 1; });
  var exactMulti = exact.filter(function (o) { return o.t.length > 1; });
  var prefixMulti = prefix.filter(function (o) { return o.t.length > 1; });
  function singleRecentSort(arr, fixAnchor) {
    arr.sort(function (a, b) {
      var ra = recentRank(a.t), rb = recentRank(b.t);
      if (ra !== rb) return rb - ra;      // 用户刚上屏的单字在单字区置顶（词频学习）
      return b.f - a.f;
    });
    if (fixAnchor && arr.length > 1) {    // 简码：码表最高频锚字固定首位，其余再学习
      var ai = arr.reduce(function (m, o, i) { return o.f > arr[m].f ? i : m; }, 0);
      var an = arr.splice(ai, 1)[0]; arr.unshift(an);
    }
  }
  singleRecentSort(exactSingle, cLen < 4);  // 简码锚字固定；全码单字 recent+高频
  prefixSingle.sort(function (a, b) { return recentRank(b.t) + b.f - (recentRank(a.t) + a.f); });
  function multiSort(arr) {
    arr.sort(function (a, b) {
      var ra = recentRank(a.t), rb = recentRank(b.t);
      if (ra !== rb) return rb - ra;                                   // 用户词/最近上屏跨长度置顶，新鲜度优先
      if (a.t.length !== b.t.length) return a.t.length - b.t.length;   // 非常用词：二字→三字→四字
      return b.f - a.f;                                                // 同长度按高频
    });
  }
  multiSort(exactMulti); multiSort(prefixMulti);
  var list;
  if (cLen === 4) list = exactMulti.concat(prefixMulti, exactSingle, prefixSingle); // 四码：词组优先
  else list = exactSingle.concat(prefixSingle, exactMulti, prefixMulti);           // 简码：单字在前
  // 编码到对应中文词时，符号/表情紧跟该词插入；词不在列表则放首选之后
  SYMBOL_WORDS.forEach(function (sw) {
    var wc = WORD2CODE[sw.w];
    if (wc && (code === wc || code.indexOf(wc) === 0) && list.every(function (o) { return o.t !== sw.out; })) {
      var wi = -1, i;
      for (i = 0; i < list.length; i++) { if (list[i].t === sw.w) { wi = i; break; } }
      list.splice(wi >= 0 ? wi + 1 : Math.min(1, list.length), 0, { t: sw.out, f: 0 });
    }
  });
  return list.slice(0, 30).map(function (o) { return o.t; });
}

/* ---------- 实时计算 ---------- */
function calcValue(expr) {
  if (!expr) return null;
  var s = expr.replace(/×/g, "*").replace(/÷/g, "/").replace(/−/g, "-").replace(/，/g, ".").replace(/,/g, ".");
  s = s.replace(/(\d+(?:\.\d+)?)%/g, "($1/100)");
  if (!/^[-+/*().\d\s]+$/.test(s) || /[+\-*/.]$/.test(s.trim())) return null;
  try {
    var v = Function('"use strict";return (' + s + ")")();
    if (typeof v === "number" && isFinite(v)) {
      v = Math.round(v * 1e6) / 1e6;
      return v;
    }
  } catch (e) {}
  return null;
}

/* ---------- 翻译 ---------- */
var trChip = null, trSkip = "";
function translate(text, dir, cb) {
  if (!text || text.length > 60) { cb(null); return; }
  var pair = dir === "zh2en" ? "zh-CN|en" : "en|zh-CN";
  var url = "https://api.mymemory.translated.net/get?q=" + encodeURIComponent(text) + "&langpair=" + pair;
  L("翻译请求:" + text + " " + dir);
  fetch(url).then(function (r) { return r.json(); }).then(function (j) {
    var t = j && j.responseData && j.responseData.translatedText;
    if (t) t = t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, "&").trim();
    L("翻译结果:" + t);
    cb(t || null);
  }).catch(function (e) { L("翻译失败:" + e.message); cb(null); });
}

/* ============================================================
 * 面板渲染
 * ============================================================ */
var LETTERS_R1 = ["q","w","e","r","t","y","u","i","o","p"];
var LETTERS_R2 = ["a","s","d","f","g","h","j","k","l"];
var LETTERS_R3 = ["z","x","c","v","b","n","m"];
var NUM_ROW = [
  { n: "1", long: "！" }, { n: "2", long: "＠" }, { n: "3", long: "＃" }, { n: "4", long: "￥" },
  { n: "5", long: "％" }, { n: "6", long: "……" }, { n: "7", long: "＆" }, { n: "8", long: "＊" },
  { n: "9", long: "（）" }, { n: "0", long: "「」" }
];
var COMMON_PUNCT = ["，","。","？","！","、","：","；","“”","‘’","（","）","《","》","…","—","·"];
/* 字母键上滑标点（键面上标，上滑上屏） */
var KEY_PUNCT = {
  q:"《", w:"》", e:"“", r:"”", t:"…", y:"—", u:"【", i:"】", o:"「", p:"」",
  a:"，", s:"。", d:"？", f:"！", g:"、", h:"：", j:"；", k:"（", l:"）",
  z:"～", x:"@", c:"#", v:"$", b:"％", n:"&", m:"·"
};
function letterKey(c) {
  var k = el("button", "key letter-key");
  k.setAttribute("type", "button"); k.setAttribute("data-letters", c);
  var pp = el("span", "k-punct"); pp.textContent = KEY_PUNCT[c] || "";
  var lt = el("span", "k-letter"); lt.textContent = c.toUpperCase();
  k.appendChild(pp); k.appendChild(lt);
  return k;
}

function key(cls, attrs, label, small) {
  var k = el("button", "key " + (cls || ""));
  k.setAttribute("type", "button");
  if (attrs) Object.keys(attrs).forEach(function (a) { k.setAttribute(a, attrs[a]); });
  if (small) {
    var s = el("span", "alt"); s.textContent = small; k.appendChild(s);
    var m = el("span", "main"); m.textContent = label; k.appendChild(m);
  } else k.textContent = label;
  return k;
}

function renderLetters() {
  var rn = $("#rowNum"); rn.innerHTML = "";
  NUM_ROW.forEach(function (o) {
    rn.appendChild(key("", { "data-num": o.n, "data-long": o.long }, o.n));
  });
  var r1 = $("#row1"); r1.innerHTML = "";
  LETTERS_R1.forEach(function (c) { r1.appendChild(letterKey(c)); });
  var r2 = $("#row2"); r2.innerHTML = "";
  LETTERS_R2.forEach(function (c) { r2.appendChild(letterKey(c)); });
  var r3 = $("#row3"); r3.innerHTML = "";
  r3.appendChild(key("fn", { id: "shiftKey", "data-act": "shift" }, "⇧"));
  LETTERS_R3.forEach(function (c) { r3.appendChild(letterKey(c)); });
  r3.appendChild(key("fn", { "data-act": "del", "aria-label": "退格" }, "⌫"));
  var r4 = $("#row4"); r4.innerHTML = "";
  r4.appendChild(key("fn", { "data-act": "number" }, "123"));
  r4.appendChild(punctToggleKey("lpunct"));
  var sp = key("", { id: "space", "data-act": "space" }, "");
  sp.innerHTML = '空格<span class="sp-mic">🎤长按语音</span>';
  r4.appendChild(sp);
  r4.appendChild(punctToggleKey("rpunct"));
  r4.appendChild(key("enter", { "data-act": "enter", "aria-label": "回车" }, "↵"));
  renderLetterFaces();
  renderPunctToggles();
}

function isSentStart() {
  var b = state.before;
  if (!b) return true;
  return /[。！？!?\.…\n"」』）]$/.test(b) || /^\s*$/.test(b);
}
function isUpper() { return state.shift !== "lower"; }
/* 英文单字母上屏：lower 强制小写；upper 时句首大写、句中小写 */
function enLetterCase(c) {
  if (state.isPassword) return state.shift === "upper" ? c.toUpperCase() : c;  // 密码：只看 Shift，不句首大写
  if (state.shift === "lower") return c;
  return isSentStart() ? c.toUpperCase() : c;
}
function enCase(word) {
  if (state.isPassword) return state.shift === "upper" ? word.toUpperCase() : word;
  if (state.shift === "lower") return word;
  if (isSentStart() && word) return word[0].toUpperCase() + word.slice(1);
  return word;
}
function renderLetterFaces() {
  var upper = isUpper();
  $all("[data-letters]").forEach(function (k) {
    var c = k.getAttribute("data-letters");
    var lt = k.querySelector(".k-letter");
    if (lt) lt.textContent = upper ? c.toUpperCase() : c;
  });
  var sk = $("#shiftKey");
  if (sk) {
    sk.textContent = "⇧";
    sk.className = "key fn shift-" + state.shift;
    sk.setAttribute("data-act", "shift");
  }
}
function punctToggleKey(id) {
  var k = el("button", "key fn punct-toggle");
  k.setAttribute("type", "button"); k.id = id;
  var m = el("span", "pt-main"); var a = el("span", "pt-alt");
  k.appendChild(m); k.appendChild(a);
  return k;
}
function renderPunctToggles() {
  var lp = $("#lpunct .pt-main"), la = $("#lpunct .pt-alt");
  var rp = $("#rpunct .pt-main"), ra = $("#rpunct .pt-alt");
  if (isZh()) {
    lp.textContent = state.lpZh; la.textContent = state.lpZh === "，" ? "！" : "，";
    rp.textContent = state.rpZh; ra.textContent = state.rpZh === "。" ? "？" : "。";
  } else {
    lp.textContent = state.lpEn; la.textContent = state.lpEn === "," ? "!" : ",";
    rp.textContent = state.rpEn; ra.textContent = state.rpEn === "." ? "?" : ".";
  }
}

/* ---------- 数字键盘（左运算符 / 中九宫格123·456·789 / 右功能） ---------- */
function renderNumber() {
  var g = $("#npGrid"); g.innerHTML = "";
  function npK(label, cls, attrs, r, c) {
    var k = el("button", "np-key " + (cls || ""));
    k.setAttribute("type", "button");
    if (attrs) Object.keys(attrs).forEach(function (n) { k.setAttribute(n, attrs[n]); });
    if (r) k.style.gridRow = r;
    if (c) k.style.gridColumn = c;
    k.textContent = label;
    return k;
  }
  // 左列：跨3行的运算符长条，竖排 ＋ － × ÷
  var oc = el("div", "np-opcol");
  oc.style.gridColumn = 1; oc.style.gridRow = "1 / span 3";
  [["+","＋"],["−","－"],["×","×"],["÷","÷"]].forEach(function (p) {
    var b = el("button", "np-opsub"); b.setAttribute("type", "button");
    b.setAttribute("data-calc", p[0]); b.textContent = p[1]; oc.appendChild(b);
  });
  g.appendChild(oc);
  // 中三列：123 / 456 / 789（1 在左上角）
  for (var n = 1; n <= 9; n++) {
    var i = n - 1, r = Math.floor(i / 3) + 1, c = (i % 3) + 2;
    g.appendChild(npK(String(n), "", { "data-num": String(n) }, r, c));
  }
  // 右列：退格 / @ / 空格(单击=上屏默认备选，优先计算纯结果)
  g.appendChild(npK("⌫", "fnr", { "data-act": "del", "aria-label": "退格" }, 1, 5));
  g.appendChild(npK("@", "fnr", { "data-act": "commitAt" }, 2, 5));
  g.appendChild(npK("空格", "np-space", { "data-act": "npSpace", "aria-label": "空格" }, 3, 5));
  // 底行：返回 / ％（0 左）/ 0（在 8 正下方）/ 小数点（0 右）/ 回车；符号切换走工具栏
  g.appendChild(npK("返回", "fnr", { "data-act": "backLetters" }, 4, 1));
  g.appendChild(npK("％", "fnr", { "data-calc": "%", "aria-label": "百分号" }, 4, 2));
  g.appendChild(npK("0", "", { "data-num": "0" }, 4, 3));
  g.appendChild(npK(".", "np-dot", { "data-num": "." }, 4, 4));
  g.appendChild(npK("↵", "enter", { "data-act": "enter", "aria-label": "回车" }, 4, 5));
  renderCalc();
}
function renderCalc() {
  var ex = $("#calcExprBtn"), rs = $("#calcResBtn");
  if (!state.calc) { ex.textContent = "算式（自动计算）"; rs.textContent = "="; return; }
  var v = calcValue(state.calc);
  if (state.calcDone) {
    ex.textContent = state.lastExpr + " = " + state.calc;
    rs.textContent = state.calc;
  } else {
    ex.textContent = state.calc + (v != null ? " = " + v : "");
    rs.textContent = v != null ? v : "=";
  }
}
function calcAppend(x) {
  if (state.calcDone) {
    // 结果之后：运算符/括号基于结果续算；数字/小数点开始新算式
    if (/[0-9.]/.test(x)) state.calc = "";
    state.calcDone = false;
  }
  state.calc += x;
  renderCalc();
}
function calcDelTail() {
  if (state.calcDone) { state.calc = ""; state.calcDone = false; }
  else state.calc = state.calc.slice(0, -1);
  renderCalc();
}
function calcEquals() {
  var v = calcValue(state.calc);
  if (v == null) { toast("算式不完整"); return; }
  state.lastExpr = state.calc;
  state.calc = String(v);
  state.calcDone = true;
  vib(12);
  renderCalc();
}

/* ---------- 符号面板（分页 + 拖动） ---------- */
var PUNCT_TABS = [
  { n: "常用", p: ["，","。","？","！","、","：","；","“","”","‘","’","（","）","《","》","〈","〉","【","】","…","—","～","·","￥","％","‰","℃","°","※","§","№","々","「","」","『","』","〖","〗","〒","¤"] },
  { n: "中文", p: ["、","。","々","—","～","「","」","『","』","【","】","〔","〕","〈","〉","《","》","﹃","﹄","﹁","﹂","…","‰","※","〒","〖","〗","〘","〙","〚","〛","㏇","㏍","㎞","㎏","㎡","㏎","㏑","㏒","￠"] },
  { n: "数学", p: ["＋","－","×","÷","＝","≠","≈","≡","＜","＞","≤","≥","±","∑","∏","√","∝","∞","∫","∮","∵","∴","∈","∉","⊆","⊇","⊂","⊃","∪","∩","∠","⊥","∥","∧","∨","％","‰","π","²","³"] },
  { n: "特殊", p: ["★","☆","◆","◇","○","●","◎","□","■","△","▲","▽","▼","§","№","※","→","←","↑","↓","↔","↕","♠","♣","♥","♦","☀","☁","☂","☃","☎","✈","⚓","✿","☑","✔","✘","❀","❄","✨"] },
  { n: "英文", p: [".",",","?","!","(",")",":",";","\"","'","[","]","{","}","-","_","@","#","$","%","^","&","*","+","=","<",">","/","\\","|","~","`","€","£","¥","¢","•","…","—","©"] }
];
function renderPunct() {
  var tabs = $("#punctSeg"), pages = $("#punctPages"), dots = $("#punctDots");
  tabs.innerHTML = ""; pages.innerHTML = ""; dots.innerHTML = "";
  function setPage(idx) {
    if (SOFT_GPU) {
      $all(".page", pages).forEach(function (p, i) { p.classList.toggle("active", i === idx); });
    } else {
      pages.scrollTo({ left: pages.children[idx].offsetLeft, behavior: "smooth" });
    }
    $all("button", tabs).forEach(function (b, i) { b.classList.toggle("on", i === idx); });
    $all("i", dots).forEach(function (d, i) { d.className = i === idx ? "on" : ""; });
  }
  PUNCT_TABS.forEach(function (tab, ti) {
    var b = el("button", ti === 0 ? "on" : ""); b.textContent = tab.n; b.setAttribute("type", "button");
    b.addEventListener("click", function () { setPage(ti); });
    tabs.appendChild(b);
    var pg = el("div", "page" + (SOFT_GPU && ti === 0 ? " active" : ""));
    tab.p.forEach(function (ch) {
      var k = el("button", "key punct"); k.setAttribute("type", "button"); k.textContent = ch;
      k.addEventListener("click", function () { commitText(ch); });
      pg.appendChild(k);
    });
    pages.appendChild(pg);
    dots.appendChild(el("i", ti === 0 ? "on" : ""));
  });
  if (!SOFT_GPU) pages.addEventListener("scroll", function () {
    var idx = Math.round(pages.scrollLeft / pages.clientWidth);
    $all("#punctSeg button").forEach(function (b, i) { b.classList.toggle("on", i === idx); });
    $all("#punctDots i").forEach(function (d, i) { d.className = i === idx ? "on" : ""; });
  });
}

/* ---------- 表情面板 ---------- */
var EMOJI_TABS = [
  { n: "😀", p: ["😀","😁","😂","🤣","😃","😄","😅","😆","😉","😊","😋","😎","😍","😘","🥰","😗","🤗","🤔","😐","😑","😶","🙄","😏","😣","😥","😮","🤐","😯","😪","😫","🥱","😴","😌","😛","😜","😝","🤤","😒","😓","😔","😕","🙃","🤑","😲","☹","🙁","😖","😞","😟","😤","😢","😭","😦","😧","😨","😩","🤯","😬","😰","😱","🥵","🥶","😳","🤪","😵","🥴","😠","😡","🤬","😷","🤒","🤕","🤢","🤮","🥳","🥺","🤠","🤡","🤥","🤫","🤭","🧐","🤓","😇","💀","👻","👽","🤖","💩","😺","😸","😹","😻","😼","😽","🙀","😿","😾"] },
  { n: "👌", p: ["👋","🤚","🖐","✋","🖖","👌","🤌","🤏","✌","🤞","🤟","🤘","🤙","👈","👉","👆","🖕","👇","☝","👍","👎","✊","👊","🤛","🤜","👏","🙌","👐","🤲","🤝","🙏","✍","💪","🦾","🦵","🦶","👂","🦻","👃","🧠","🦷","🦴","👀","👁","👅","👄","💋","👶","🧒","👦","👧","🧑","👨","👩","🧓","👴","👵","👮","🕵","💂","👷","🤴","👸","🎅","🤶","🦸","🦹","🧙","🧚","🧛","🧜","🧝","🧞","🧟","💆","💇","🚶","🧍","🧎","🏃","💃","🕺","👯","🧖","🧗","🤺","🏇","⛷","🏂","🏌","🏄","🚣","🏊","⛹","🏋","🚴","🚵","🤸","🤼","🤽","🤾","🤹","🧘"] },
  { n: "🍜", p: ["🍏","🍎","🍐","🍊","🍋","🍌","🍉","🍇","🍓","🫐","🍈","🍒","🍑","🥭","🍍","🥥","🥝","🍅","🍆","🥑","🥦","🥬","🥒","🌶","🌽","🥕","🫒","🧄","🧅","🥔","🍠","🥐","🥯","🍞","🥖","🥨","🧀","🥚","🍳","🧈","🥞","🧇","🥓","🥩","🍗","🍖","🌭","🍔","🍟","🍕","🫓","🥪","🥙","🧆","🌮","🌯","🫔","🥗","🥘","🫕","🥫","🍝","🍜","🍲","🍛","🍣","🍱","🥟","🦪","🍤","🍙","🍚","🍘","🍥","🥠","🥮","🍢","🍡","🍧","🍨","🍦","🥧","🧁","🍰","🎂","🍮","🍭","🍬","🍫","🍿","🍩","🍪","🌰","🥜","🍯","🥛","🍼","🫖","☕","🍵","🧃","🥤","🧋","🍶","🍺","🍻","🥂","🍷","🥃","🍸","🍹","🧉","🍾","🧊","🥄","🍴","🍽","🥣","🥡","🥢","🧂"] },
  { n: "❤️", p: ["❤️","🧡","💛","💚","💙","💜","🖤","🤍","🤎","💔","❣️","💕","💞","💓","💗","💖","💘","💝","💟","♥️","💌","💋","💯","💢","💥","💫","💦","💨","🕳","💬","💭","💤","🔥","✨","⭐","🌟","⚡","☄","☀","🌤","⛅","🌥","☁","🌦","🌧","⛈","🌩","🌨","❄","☃","⛄","🌬","💧","💦","☔","☂","🌊","🌫","🌈","🎉","🎊","🎁","🎈","🌹","🌸","🌺","🌻","🌼","💐","🍀","🍃","🍂","🍁","🌱","🌿","🪴","🌳","🌲","🌴","🌵","🌾","🌍","🌎","🌏","🌑","🌒","🌓","🌔","🌕","🌖","🌗","🌘","🌙","🌚","🌛","🌜"] },
  { n: "🚗", p: ["🚗","🚕","🚙","🚌","🚎","🏎","🚓","🚑","🚒","🚐","🛻","🚚","🚛","🚜","🛴","🚲","🛵","🏍","🛺","🚨","🚔","🚍","🚘","🚖","🚡","🚠","🚟","🚃","🚋","🚞","🚝","🚄","🚅","🚈","🚂","🚆","🚇","🚊","🚉","✈","🛫","🛬","🛩","💺","🛰","🚀","🛸","🚁","🛶","⛵","🚤","🛥","🛳","⛴","🚢","⚓","⛽","🚧","🚦","🚥","🗺","🗿","🗽","🗼","🏰","🏯","🏟","🎡","🎢","🎠","⛲","⛱","🏖","🏝","🏜","🌋","⛰","🏔","🗻","🏕","⛺","🏠","🏡","🏘","🏚","🏗","🏭","🏢","🏬","🏣","🏤","🏥","🏦","🏨","🏪","🏫","🏩","💒","🏛","⛪","🕌","🕍","🛕","🕋","⛩","🌁","🌃","🏙","🌄","🌅","🌆","🌇","🌉","🎑"] }
];
function renderEmoji() {
  var tabs = $("#emojiTabs"), pages = $("#emojiPages"), dots = $("#emojiDots");
  tabs.innerHTML = ""; pages.innerHTML = ""; dots.innerHTML = "";
  function setPage(idx) {
    if (SOFT_GPU) {
      $all(".page", pages).forEach(function (p, i) { p.classList.toggle("active", i === idx); });
    } else {
      pages.scrollTo({ left: pages.children[idx].offsetLeft, behavior: "smooth" });
    }
    $all("button", tabs).forEach(function (b, i) { b.classList.toggle("on", i === idx); });
    $all("i", dots).forEach(function (d, i) { d.className = i === idx ? "on" : ""; });
  }
  EMOJI_TABS.forEach(function (tab, ti) {
    var b = el("button", ti === 0 ? "on" : ""); b.textContent = tab.n; b.setAttribute("type", "button");
    b.addEventListener("click", function () { setPage(ti); });
    tabs.appendChild(b);
    var pg = el("div", "page" + (SOFT_GPU && ti === 0 ? " active" : ""));
    tab.p.forEach(function (ch) {
      var k = el("button", "emoji"); k.setAttribute("type", "button"); k.textContent = ch;
      k.addEventListener("click", function () { commitText(ch); });
      pg.appendChild(k);
    });
    pages.appendChild(pg);
    dots.appendChild(el("i", ti === 0 ? "on" : ""));
  });
  if (!SOFT_GPU) pages.addEventListener("scroll", function () {
    var idx = Math.round(pages.scrollLeft / pages.clientWidth);
    $all("#emojiTabs button").forEach(function (b, i) { b.classList.toggle("on", i === idx); });
    $all("#emojiDots i").forEach(function (d, i) { d.className = i === idx ? "on" : ""; });
  });
}

/* ---------- 常用短语 ---------- */
var PHRASES = [
  "好的，收到。","稍等，我马上处理。","不好意思，让您久等了。","请问还有什么可以帮您？","谢谢！","辛苦了！",
  "在吗？方便接电话吗？","我现在开会，稍后回复。","已收到，感谢！","麻烦您了，非常感谢！","收到请回复，谢谢。",
  "今天天气不错。","你在哪里？我过去找你。","路上注意安全。","早点休息，晚安。","新年快乐，万事如意！",
  "祝你生日快乐！","恭喜发财，大吉大利！","周末有空一起吃饭吗？","我到了，在门口等你。","麻烦发一下定位。",
  "请把文件发到我邮箱。","这个多少钱？","能便宜点吗？","我要这个，谢谢。","发票请开公司抬头。",
  "地址：","电话：","微信号：","账号：","密码：","验证码："
];
function renderPhrase() {
  var box = $("#phraseList"); box.innerHTML = "";
  PHRASES.forEach(function (p) {
    var b = el("button", "ph-item"); b.setAttribute("type", "button"); b.textContent = p;
    b.addEventListener("click", function () { commitText(p); showPanel("letters"); });
    box.appendChild(b);
  });
}

/* ---------- 剪贴板 ---------- */
function saveClips() { save("cw_clips", state.clips); }
function pullClip() {
  if (state.isPassword || state.numPassword) return;   // 密码框不读取/收集剪贴板
  if (!B || typeof B.clipRead !== "function") return;
  try {
    var t = B.clipRead();
    if (!t) return;
    t = String(t).trim();
    if (!t || t.length > 200) return;
    if (state.clips[0] === t) return;
    state.clips = state.clips.filter(function (x) { return x !== t; });
    state.clips.unshift(t);
    if (state.clips.length > 30) state.clips.length = 30;
    saveClips();
    if (state.panel === "clip") renderClip();
    L("剪贴板更新:" + t.slice(0, 12));
  } catch (e) { L("剪贴板读取失败:" + e.message); }
}
function renderClip() {
  var box = $("#clipList"); box.innerHTML = "";
  // 密码框：完全不暴露剪贴板历史（含此前收集内容），防隐私泄露
  if (state.isPassword || state.numPassword) {
    var pe = el("div", "clip-empty");
    pe.textContent = "密码框已保护剪贴板";
    box.appendChild(pe);
    return;
  }
  if (!state.clips.length) {
    var e = el("div", "clip-empty");
    e.innerHTML = "剪贴板为空<br>复制过的文字会自动收集到这里<br>点按上屏 · 长按或点 ✕ 删除";
    box.appendChild(e);
    return;
  }
  state.clips.forEach(function (t, i) {
    var item = el("button", "clip-item"); item.setAttribute("type", "button");
    var idx = el("span", "clip-idx"); idx.textContent = (i + 1);
    var tx = el("span", "clip-text"); tx.textContent = t;
    var d = el("span", "clip-del"); d.setAttribute("data-clip-del", i); d.textContent = "✕";
    item.appendChild(idx); item.appendChild(tx); item.appendChild(d);
    box.appendChild(item);
  });
}
function deleteClip(i) {
  if (isNaN(i) || i < 0 || i >= state.clips.length) return;
  state.clips.splice(i, 1); saveClips(); renderClip(); toast("已删除");
}

/* ============================================================
 * 输入动作
 * ============================================================ */
function commitText(t) {
  if (!t) return;
  playClick();
  bridge(function (b) { b.commit(t); });
  if (!isApk()) { var ti = $("#testInput"); ti.value += t; }
  state.buf = "";
  state.cands = [];
  state.before += t;
  rememberRecent(t);
  if (state.shift === "once") { state.shift = "off"; }
  renderCands(); renderLetterFaces();
  scheduleCtx();
}
function rememberRecent(t) {
  if (!/[\u4e00-\u9fa5]/.test(t)) return;
  function put(x) { var ix = state.recent.indexOf(x); if (ix >= 0) state.recent.splice(ix, 1); state.recent.unshift(x); }
  if (t.length >= 2) put(t);                          // 整词记录 → 同编码再打时置顶（用户词学习）
  for (var i = t.length - 1; i >= 0; i--) put(t[i]);  // 单字也记录，逆序使首字靠前
  if (state.recent.length > 200) state.recent.length = 200;
  save("cw_recent", state.recent);
}
function delOnce() {
  if (state.buf) { state.buf = state.buf.slice(0, -1); afterBufChange(); if (state.shift === "once") { state.shift = "off"; renderLetterFaces(); } return; }
  playClick();
  bridge(function (b) { b.del(1); });
  if (!isApk()) { var ti = $("#testInput"); ti.value = ti.value.slice(0, -1); state.before = ti.value; }
  else if (state.before) state.before = state.before.slice(0, -1);
  if (state.panel === "number") calcDelTail();
  renderLetterFaces();
  scheduleCtx();
  if (state.mode === "en") refreshEnComplete();
}
function sendEnter() {
  playClick();
  bridge(function (b) { b.sendEnter(); });
  state.before += "\n";
  renderLetterFaces();
}
function commitCode() { // 回车：上屏当前编码/英文缓冲，绝不上中文候选
  if (!state.buf) { sendEnter(); return; }
  if (state.mode === "en") commitText(enCase(state.buf));
  else commitText(state.buf);
}

function afterBufChange() {
  if (state.mode === "en") state.cands = enPrefixCands(state.buf);
  else state.cands = state.buf ? queryWubi(state.buf) : [];
  renderCands();
}
function enPrefixCands(pre) {
  pre = pre.toLowerCase();
  if (!pre) return [];
  return (EN_INDEX[pre] || []).slice(0, 12);
}
function enWordPrefix() {
  var before = "";
  try { before = B ? (B.contextBefore(40) || "") : ($("#testInput").value || ""); } catch (e) {}
  var m = before.match(/[A-Za-z'][A-Za-z'\-]*$/);
  return m ? m[0] : "";
}
function refreshEnComplete() {
  state.buf = "";
  if (state.isPassword) { state.enPre = ""; state.ctxCands = []; renderCands(); return; }  // 密码不补全
  if (state.mode !== "en") { state.enPre = ""; state.ctxCands = []; renderCands(); return; }
  refreshContext();
}
function pressLetter(c) {
  playClick();
  if (state.mode === "en" || state.isPassword) {  // 密码框：字母逐字符上屏，不进五笔编码
    commitText(enLetterCase(c));
    refreshEnComplete();
    renderLetterFaces();
    return;
  }
  state.buf += c;
  afterBufChange();
}
function pressNumber(n) {
  playClick();
  // 数字面板：数字不自动上屏，只进算式自动算结果，用户选结果才上屏；数字密码逐位上屏
  if (state.panel === "number") { if (state.numPassword) commitText(n); else calcAppend(n); return; }
  if (state.isPassword) { commitText(n); return; }  // 文本密码框：数字直接上屏
  // 字母面板数字行：五笔编码中 1-9 快选候选
  if (state.buf && isZh() && /[1-9]/.test(n) && state.cands.length) {
    var i = parseInt(n, 10) - 1;
    if (state.cands[i]) { pickCand(state.cands[i]); return; }
  }
  commitText(n);
}
function pickCand(w) {
  if (state.mode === "en") commitText(enCase(w));
  else commitText(w);
}
var lastSpaceAt = 0;
function actSpace() {
  var now = Date.now(), dbl = now - lastSpaceAt < 300;
  if (state.buf) {
    lastSpaceAt = 0;   // 上屏候选/编码，不计双击；空格选词不带空格
    if (state.cands && state.cands.length) pickCand(state.cands[0]);
    else commitText(state.mode === "en" ? enCase(state.buf) : state.buf);
    return;
  }
  // 双击空格 → 句号 + 空格（密码框不触发自动标点）
  if (dbl && !state.isPassword) {
    bridge(function (b) { b.del(1); });   // 删掉第一次上的空格
    commitText(isZh() ? "。" : ".");
    commitText(" ");
    lastSpaceAt = 0;
    return;
  }
  lastSpaceAt = now;
  if (state.mode === "en") { state.enPre = ""; state.cands = []; renderCands(); }
  commitText(" ");
}
function actEnter() {
  if (state.buf) { commitCode(); return; }
  sendEnter();
}
/* 数字盘空格：单击上屏默认备选（计算纯结果优先，等同点结果钮）；无算式则上屏空格 */
function actNpSpace() {
  var v = state.calcDone ? state.calc : calcValue(state.calc);
  if (state.calc && v != null && !isNaN(v)) {
    commitText(String(v));
    state.calc = String(v); state.calcDone = true; renderCalc();
  } else commitText(" ");
}

/* 标点切换键 */
function punctPair(which) {
  if (which === "l") return isZh() ? ["，", "！"] : [",", "!"];
  return isZh() ? ["。", "？"] : [".", "?"];
}
function punctCurrent(which) {
  return isZh() ? (which === "l" ? state.lpZh : state.rpZh) : (which === "l" ? state.lpEn : state.rpEn);
}
function setPunct(which, v) {
  var k = isZh() ? (which === "l" ? "cw_lpZh" : "cw_rpZh") : (which === "l" ? "cw_lpEn" : "cw_rpEn");
  if (isZh()) { if (which === "l") state.lpZh = v; else state.rpZh = v; }
  else { if (which === "l") state.lpEn = v; else state.rpEn = v; }
  localStorage.setItem(k, v);
  renderPunctToggles();
}

/* Shift 二态：upper（大写，默认）↔ lower（小写） */
function cycleShift() {
  state.shift = state.shift === "lower" ? "upper" : "lower";
  renderLetterFaces();
  toast(state.shift === "lower" ? "小写输入" : "大写输入");
}

/* 模式切换（排它） */
function cycleMode() {
  state.mode = state.mode === "smart" ? "wubi" : state.mode === "wubi" ? "en" : "smart";
  state.buf = ""; state.cands = []; state.ctxCands = [];
  state.shift = "upper";
  updateModeUI(); renderLetterFaces(); renderPunctToggles(); renderCands(); scheduleCtx();
  toast(state.mode === "smart" ? "中英混输（五笔）" : state.mode === "wubi" ? "纯五笔" : "英文");
}
function updateModeUI() {
  var b = $("#modeBtn");
  if (state.panel !== "letters") {
    b.textContent = "ABC"; b.classList.remove("en"); return;
  }
  b.textContent = state.mode === "smart" ? "混" : state.mode === "wubi" ? "中" : "EN";
  b.classList.toggle("en", state.mode === "en");
}

/* 面板切换（单一排它，统一返回） */
function showPanel(n) {
  state.panel = n;
  $all("#panels > .panel").forEach(function (p) { p.classList.toggle("active", p.id === "p-" + n); });
  if (n === "clip") { pullClip(); renderClip(); }
  if (n === "settings") { refreshDiagView(); renderEngineList(); }
  if (n !== "letters" && n !== "number") { state.buf = ""; state.cands = []; renderCands(); }
  updateNumSymSwitch(n);
  updateModeUI();
  if (SOFT_GPU) {
    // SwiftShader 下新切换面板首次光栅化会透明：强制 panels 重绘（真机硬件GPU不触发）
    var pp0 = $("#panels");
    pp0.style.transition = "none";
    pp0.style.opacity = "0.99";
    void pp0.offsetHeight;
    pp0.style.opacity = "";
  }
}
/* 工具栏「数字|符号」切换：仅在数字/符号面板显示，高亮当前，单一排它 */
function updateNumSymSwitch(n) {
  var sw = $("#numSymSwitch");
  $all("button", sw).forEach(function (b) {
    var a = b.getAttribute("data-act");
    b.classList.toggle("active", (a === "number" && n === "number") || (a === "punct" && n === "punct"));
  });
}

/* 左上角键：字母面板=语言切换（混/中/EN）；子面板=ABC 返回字母键盘 */
function modeBtnTap() {
  playClick();
  if (state.panel !== "letters") { showPanel("letters"); return; }
  cycleMode();
}

/* ---------- 候选栏 ---------- */
function renderCands() {
  var box = $("#cands"); box.innerHTML = "";
  var list = [];
  if (state.buf) {
    var bt = el("span", "buftag"); bt.textContent = state.buf; box.appendChild(bt);
    list = state.cands.map(function (t, i) {
      return { t: t, n: i < 9 ? String(i + 1) : "", cls: i === 0 ? "cand sel" : "cand", tr: false };
    });
  } else {
    list = state.ctxCands || [];
  }
  list.forEach(function (c) {
    var b = el("button", c.cls || "cand"); b.setAttribute("type", "button");
    if (c.n) { var num = el("span", "num"); num.textContent = c.n; b.appendChild(num); }
    var tx = el("span"); tx.textContent = c.t; b.appendChild(tx);
    box.appendChild(b);
  });
}

/* ---------- 光标跟随：联想 + 整段翻译 ---------- */
var ctxTimer = null;
function scheduleCtx() {
  clearTimeout(ctxTimer);
  if (state.isPassword || state.numPassword) { state.ctxCands = []; state.enPre = ""; renderCands(); return; }  // 密码不联想/翻译
  ctxTimer = setTimeout(refreshContext, 320);
}
function getBefore(n) {
  if (B && B.contextBefore) { try { return B.contextBefore(n || 40) || ""; } catch (e) {} }
  return $("#testInput").value.slice(-(n || 40));
}
function refreshContext() {
  var before = getBefore(40);
  state.before = before;
  renderLetterFaces();
  if (state.buf) { renderCands(); return; }
  var zhTail = (before.match(/[\u4e00-\u9fa5]+$/) || [""])[0];
  var enTail = (before.match(/[a-zA-Z']+$/) || [""])[0];
  var cands = [];
  state.enPre = "";
  if (isZh() && zhTail) {
    sugFor(zhTail).forEach(function (w) { cands.push({ t: w, cls: "cand" }); });
    if (settings.trans && zhTail.length >= 2) {
      var zh = zhTail.slice(-12);
      translate(zh, "zh2en", function (en) {
        if (en && en.toLowerCase() !== zh.toLowerCase() && state.before.endsWith(zh) && !state.buf) {
          state.ctxCands = mergeTr(state.ctxCands, en); renderCands();
        }
      });
    }
  } else if (state.mode === "en" && enTail) {
    var w0 = enTail.toLowerCase();
    state.enPre = enTail;
    (EN_INDEX[w0] || []).filter(function (w) { return w.toLowerCase() !== w0; }).slice(0, 8)
      .forEach(function (w) { cands.push({ t: w, cls: "cand" }); });
    if (settings.trans && w0.length >= 2) {
      translate(w0, "en2zh", function (zh) {
        if (zh && /[\u4e00-\u9fa5]/.test(zh) && state.before.toLowerCase().endsWith(w0) && !state.buf) {
          state.ctxCands = mergeTr(state.ctxCands, zh); renderCands();
        }
      });
    }
  }
  state.ctxCands = cands;
  renderCands();
}
function mergeTr(cands, t) {
  cands = cands || [];
  var f = cands.filter(function (c) { return c.cls !== "cand tr"; });
  return [{ t: t, cls: "cand tr", tr: true }].concat(f).slice(0, 10);
}

/* ============================================================
 * 长按弹条（修复 v1.2 hold 空指针）
 * ============================================================ */
var popState = null;
function showPopup(anchor, items, onPick) {
  hidePopup();
  var p = el("div", "popup");
  items.forEach(function (it, i) {
    var s = el("span", i === 0 ? "sel" : ""); s.textContent = it; p.appendChild(s);
  });
  document.body.appendChild(p);
  var r = anchor.getBoundingClientRect();
  p.style.left = Math.max(6, Math.min(window.innerWidth - p.offsetWidth - 6, r.left + r.width / 2 - p.offsetWidth / 2)) + "px";
  p.style.top = Math.max(6, r.top - p.offsetHeight - 8) + "px";
  popState = { el: p, items: items, onPick: onPick, chosen: 0 };
}
function hidePopup() {
  if (popState) { popState.el.remove(); popState = null; }
}
function popupPickAt(x) {
  if (!popState) return;
  var spans = $all("span", popState.el), hit = 0;
  spans.forEach(function (s, i) {
    var r = s.getBoundingClientRect();
    if (x >= r.left && x <= r.right) hit = i;
    s.classList.toggle("sel", i === hit);
  });
  popState.chosen = hit;
}

/* ============================================================
 * 事件架构：click 主触发 + pointer 手势
 * ============================================================ */
var TAP_SEL = ".key,.tbtn,.cand,.np-key,.np-opsub,.num-sym button,.seg-tabs button,.seg-clear,.emoji,.set-action,.toggle,.calc-expr,.calc-res,.clip-item,.side-del,.confirm";
var ptr = null;
var suppressEl = null;
/* 只抑制「指定元素」那一次 click：上滑/长按后浏览器未必发 click，故按元素而非全局标志 */
function suppressNextClick(el) {
  suppressEl = el;
  setTimeout(function () { if (suppressEl === el) suppressEl = null; }, 450);
}

function longKind(el0) {
  if (el0.matches('[data-act="del"]')) return "del";
  if (el0.id === "space" || el0.getAttribute("data-act") === "space") return "space";
  if (el0.id === "lpunct" || el0.id === "rpunct") return "ptoggle";
  if (el0.id === "shiftKey") return "ctx";
  if (el0.classList.contains("clip-item")) return "clip";
  if (el0.hasAttribute("data-long")) return "pop";
  return null;
}

document.addEventListener("pointerdown", function (e) {
  if (e.target.closest(".popup")) return;
  if (e.target.closest(".clip-del")) return; // ✕ 交给 click
  var topZone = e.target.closest("#candbar,#toolbar");
  var el0 = e.target.closest(TAP_SEL) || topZone;
  if (!el0) return;
  var inScroll = e.target.closest(".pages,#clipList,.set-scroll");
  if (!inScroll) e.preventDefault();
  el0.classList.add("press");
  vib();
  ptr = { el: el0, x: e.clientX, y: e.clientY, kind: longKind(el0), long: false, timer: null, iv: null, cancel: false, cursorMode: false, curX: e.clientX, swipePunct: false, numSwipe: false, lastDx: 0, lastDy: 0, startTop: !!topZone, pullDone: false };
  if (ptr.kind) {
    var delay = ptr.kind === "del" ? 430 : ptr.kind === "clip" ? 460 : ptr.kind === "space" ? 300 : 360;
    ptr.timer = setTimeout(function () { ptr.long = true; onLong(ptr); }, delay);
  }
  document.addEventListener("pointermove", onMove);
  document.addEventListener("pointerup", onUp);
  document.addEventListener("pointercancel", onUp);
}, { passive: false });

function onMove(e) {
  if (!ptr) return;
  var dx = e.clientX - ptr.x, dy = e.clientY - ptr.y;
  // 从键盘顶部起始的垂直下滑 → 收起键盘（行业事实标准）
  if (ptr.startTop && !ptr.pullDone && dy > 20 && Math.abs(dy) > Math.abs(dx) * 1.3) {
    ptr.pullDone = true; ptr.long = true;
    ptr.el.classList.remove("press");
    bridge(function (b) { b.hideKeyboard(); });
    vib(12); L("顶部下滑收起");
    return;
  }
  // 字母键上滑 → 上屏该键对应标点。真机滑动一段后系统会 pointercancel，故阈值要小、提前抢占
  if (ptr.el.hasAttribute("data-letters") && !ptr.swipePunct && !ptr.long) {
    ptr.lastDx = dx; ptr.lastDy = dy;
    if (dy < -11 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      ptr.swipePunct = true; ptr.long = true;
      ptr.el.classList.add("swipe-punct"); ptr.el.classList.remove("press");
      vib(12); L("字母上滑标点 dy=" + dy);
    }
  }
  // 主键盘数字行上滑 → 与点击一致（上屏数字）
  if (ptr.el.closest("#rowNum [data-num]") && !ptr.swipePunct && !ptr.long) {
    ptr.lastDx = dx; ptr.lastDy = dy;
    if (dy < -11 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      ptr.swipePunct = true; ptr.numSwipe = true; ptr.long = true;
      ptr.el.classList.add("swipe-punct"); ptr.el.classList.remove("press");
      vib(12); L("数字行上滑 dy=" + dy);
    }
  }
  // 空格：短按内横拖 → 移光标（取消语音计时）
  if (ptr.kind === "space" && !ptr.long && Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
    clearTimeout(ptr.timer); ptr.cursorMode = true; ptr.curX = ptr.x; ptr.long = true;
    L("空格横拖移光标");
  }
  if (ptr.cursorMode) {
    while (Math.abs(e.clientX - ptr.curX) >= 14) {
      var step = e.clientX < ptr.curX ? -14 : 14;
      bridge(function (b) { b.cursor(step < 0 ? -1 : 1); });
      ptr.curX += step;
    }
    return;
  }
  // 语音中：上滑取消
  if (ptr.kind === "space" && ptr.long && voice.active) {
    var canc = dy < -30;
    if (canc !== ptr.cancel) { ptr.cancel = canc; setVoiceCancelUI(canc); }
    return;
  }
  if (popState) popupPickAt(e.clientX);
}

function onUp() {
  if (!ptr) return;
  var p = ptr;
  clearTimeout(p.timer);
  if (p.iv) { clearInterval(p.iv); p.iv = null; }
  document.removeEventListener("pointermove", onMove);
  document.removeEventListener("pointerup", onUp);
  document.removeEventListener("pointercancel", onUp);
  p.el.classList.remove("press");
  // 上滑：字母键上标点；数字行上滑=点击（上屏数字）。pointercancel 时用最后位移兜底
  var isNumUp = p.el.closest("#rowNum [data-num]");
  var wantSwipe = p.swipePunct
      || (p.el.hasAttribute("data-letters") && p.lastDy < -11 && Math.abs(p.lastDy) > Math.abs(p.lastDx || 0) * 1.2)
      || (isNumUp && p.lastDy < -11 && Math.abs(p.lastDy) > Math.abs(p.lastDx || 0) * 1.2);
  if (wantSwipe) {
    p.el.classList.remove("swipe-punct");
    if (p.numSwipe || isNumUp) {
      pressNumber(p.el.getAttribute("data-num"));
    } else {
      var pc = p.el.getAttribute("data-letters"), pch = KEY_PUNCT[pc];
      if (pch) commitText(pch);
    }
    p.swipePunct = true; p.long = true;
  }

  if (p.kind === "space" && p.long && voice.active && !p.cursorMode) {
    if (p.cancel) cancelVoice(); else stopVoice();
  }
  if (popState) {
    if (p.long) { var ps = popState, idx = popState.chosen; hidePopup(); ps.onPick(ps.items[idx], idx); }
    else hidePopup();
  }
  if (p.long) suppressNextClick(p.el);
  ptr = null;
}

document.addEventListener("click", function (e) {
  if (suppressEl && (e.target === suppressEl || suppressEl.contains(e.target))) {
    suppressEl = null; e.preventDefault(); e.stopImmediatePropagation(); return;
  }
  var delBtn = e.target.closest(".clip-del");
  if (delBtn) { deleteClip(parseInt(delBtn.getAttribute("data-clip-del"), 10)); return; }
  var el0 = e.target.closest(TAP_SEL);
  if (el0) handleTap(el0);
  var pt = e.target.closest("#lpunct,#rpunct");
  if (pt) { var which = pt.id === "lpunct" ? "l" : "r"; commitText(punctCurrent(which)); }
});

function onLong(p) {
  vib(14);
  if (p.kind === "del") {
    delOnce();
    p.iv = setInterval(function () { delOnce(); playClick(); }, 75);
  } else if (p.kind === "space") {
    startVoice();
  } else if (p.kind === "ptoggle") {
    var which = p.el.id === "lpunct" ? "l" : "r";
    var pair = punctPair(which), cur = punctCurrent(which);
    var items = cur === pair[0] ? pair : [pair[1], pair[0]];
    showPopup(p.el, items, function (v) { setPunct(which, v); toast("已切换：" + v); });
  } else if (p.kind === "ctx") {
    showPopup(p.el, COMMON_PUNCT, function (v) { if (v) commitText(v); });
  } else if (p.kind === "clip") {
    var dBtn = p.el.querySelector(".clip-del");
    if (dBtn) deleteClip(parseInt(dBtn.getAttribute("data-clip-del"), 10));
  } else if (p.kind === "pop") {
    var str = p.el.getAttribute("data-long");
    if (str) showPopup(p.el, str.split(""), function (v) { if (v) commitText(v); });
  }
}

/* ---------- click 路由 ---------- */
function handleTap(k) {
  if (k.classList.contains("cand")) {
    var span = k.querySelector("span:not(.num)");
    var t = span ? span.textContent : k.textContent;
    playClick();
    if (state.mode === "en" && state.enPre && t.toLowerCase().indexOf(state.enPre.toLowerCase()) === 0 && t.length > state.enPre.length) {
      commitText(t.slice(state.enPre.length));
      state.enPre = t;
    } else {
      commitText(t);
    }
    if (state.panel !== "letters" && state.panel !== "number") showPanel("letters");
    refreshEnComplete();
    return;
  }
  var ch = k.getAttribute("data-letters");
  if (ch != null) { pressLetter(ch); return; }
  var num = k.getAttribute("data-num");
  if (num != null) { pressNumber(num); return; }
  var cm = k.getAttribute("data-commit");
  if (cm != null) { if (state.panel === "number") { playClick(); calcAppend(cm); } else commitText(cm); return; }
  var op = k.getAttribute("data-calc");
  if (op != null) { playClick(); calcAppend(op); return; }
  var act = k.getAttribute("data-act");
  if (act) { doAct(act, k); return; }
  if (k.classList.contains("clip-item")) {
    var tx = k.querySelector(".clip-text");
    if (tx) { commitText(tx.textContent); showPanel("letters"); }
    return;
  }
  if (k.classList.contains("segback")) { showPanel("letters"); return; }
  if (k.classList.contains("seg-clear")) {
    state.clips = []; saveClips(); renderClip(); toast("剪贴板已清空"); return;
  }
  if (k.classList.contains("toggle")) {
    var s = k.getAttribute("data-set");
    settings[s] = !settings[s]; save("cw_settings", settings);
    k.classList.toggle("on", settings[s]);
    applySettings(); if (s === "trans") scheduleCtx();
    return;
  }
  if (k.hasAttribute("data-theme")) {
    settings.theme = k.getAttribute("data-theme"); save("cw_settings", settings); applySettings(); return;
  }
  if (k.classList.contains("calc-expr")) {
    if (state.calcDone) commitText(state.lastExpr + "=" + state.calc);
    else { var v1 = calcValue(state.calc); if (v1 != null) commitText(state.calc + "=" + v1); }
    return;
  }
  if (k.classList.contains("calc-res")) {
    var v = state.calcDone ? state.calc : calcValue(state.calc);
    if (v != null) { commitText(String(v)); state.calc = String(v); state.calcDone = true; renderCalc(); }
    return;
  }
}

function doAct(act, k) {
  switch (act) {
    case "del": delOnce(); break;
    case "space": actSpace(); break;
    case "npSpace": actNpSpace(); break;
    case "enter": actEnter(); break;
    case "shift": cycleShift(); break;
    case "ctxKey": if (isZh()) commitText("、"); else cycleShift(); break;
    case "number": showPanel("number"); break;
    case "punct":
    case "goSymbol": showPanel("punct"); break;
    case "letters":
    case "backLetters": showPanel("letters"); break;
    case "commitAt": commitText("@"); break;
    case "emoji": showPanel("emoji"); break;
    case "clip": showPanel("clip"); break;
    case "phrase": showPanel("phrase"); break;
    case "settings": showPanel("settings"); break;
    case "translate":
      settings.trans = !settings.trans; save("cw_settings", settings);
      k.classList.toggle("on", settings.trans);
      toast(settings.trans ? "整句翻译已开（需联网）" : "整句翻译已关");
      scheduleCtx();
      break;
    case "switch": bridge(function (b) { b.switchKeyboard(); }); break;
    case "hide": bridge(function (b) { b.hideKeyboard(); }); break;
    case "mode": cycleMode(); break;
    case "calcEq": calcEquals(); break;
  }
}

/* ============================================================
 * 语音（系统 SpeechRecognizer，免费）
 * ============================================================ */
var voice = { active: false, cancel: false, heard: false, bars: [], tick: 0, tStart: null, tMax: null, tResult: null };
function setSpaceVoicing(on) { var _s = document.querySelector("#space"); if (_s) _s.classList.toggle("voicing", on); }

function initWave() {
  var w = $("#voWave");
  if (!w || voice.bars.length) return;
  voice.bars = [];
  for (var i = 0; i < 22; i++) {
    var b = el("span", "vw-bar");
    b.style.height = "6px";
    w.appendChild(b); voice.bars.push(b);
  }
}
function renderWave(level) {
  var L0 = Math.max(0, Math.min(1, level / 100));
  for (var i = 0; i < voice.bars.length; i++) {
    var ph = Math.abs(Math.sin((i + voice.tick) * 0.55));
    var h = 6 + L0 * 44 * (0.3 + 0.7 * ph);
    voice.bars[i].style.height = Math.max(6, Math.min(50, h)) + "px";
  }
  voice.tick++;
}
function clearVoiceTimers() {
  if (voice.tStart) { clearTimeout(voice.tStart); voice.tStart = null; }
  if (voice.tMax) { clearTimeout(voice.tMax); voice.tMax = null; }
  if (voice.tResult) { clearTimeout(voice.tResult); voice.tResult = null; }
}
function armVoiceTimers() {
  clearVoiceTimers();
  voice.tStart = setTimeout(function () { if (voice.active && !voice.heard) voiceError("NOVOICE"); }, 10000);
}
function onVoiceHeard() {
  if (voice.heard) return;
  voice.heard = true;
  if (voice.tStart) { clearTimeout(voice.tStart); voice.tStart = null; }
  voice.tMax = setTimeout(function () {
    if (voice.active) { bridge(function (b) { b.stopVoice(); }); voiceError("TIMEOUT"); }
  }, 16000);
}
function startVoice() {
  if (!B || typeof B.startVoice !== "function") { toast("当前环境不支持语音"); return; }
  voice.active = true; voice.cancel = false; voice.heard = false; voice.tick = 0;
  initWave(); renderWave(0);
  $("#voPartial").textContent = "";
  $("#voStatus").textContent = "正在聆听…";
  $("#voDbg").textContent = "";
  $("#voPerm").style.display = "none";
  $("#voiceOverlay").classList.add("show");
  setSpaceVoicing(true);
  armVoiceTimers();
  L("语音开始");
  try { B.startVoice(); } catch (e) { L("startVoice异常:" + e.message); voiceError("EX", "启动异常:" + e.message); }
}
function stopVoice() {
  voice.active = false;
  setSpaceVoicing(false);
  bridge(function (b) { b.stopVoice(); });
  $("#voStatus").textContent = "识别中…";
  renderWave(8);
  clearVoiceTimers();
  voice.tResult = setTimeout(function () { voiceError("TIMEOUT"); }, 8000);
  L("语音停止,等待结果");
}
function cancelVoice() {
  voice.active = false; voice.cancel = true;
  setSpaceVoicing(false);
  bridge(function (b) { b.stopVoice(); });
  $("#voiceOverlay").classList.remove("show");
  clearVoiceTimers();
  toast("已取消语音");
  L("语音上滑取消");
}
function setVoiceCancelUI(canc) { $("#voStatus").textContent = canc ? "松开取消" : "松开上屏"; }
function voiceError(code, msg) {
  var ERR = {
    1: "未授权麦克风，请点下方按钮授权",
    2: "网络不可用（在线语音需联网）",
    3: "识别引擎错误，可安装/启用系统语音引擎（如 vivo 语音）",
    4: "识别超时，请长按重试",
    5: "客户端错误(" + code + ")",
    6: "服务器错误(" + code + ")",
    7: "不支持该识别语言",
    8: "存储空间不足",
    9: "识别服务繁忙，请重试",
    11: "系统拒绝了识别服务",
    13: "本机无可用语音识别服务（vivo 可在设置开启 Jovi 语音）",
    14: "未授予录音权限",
    TIMEOUT: "识别超时，没有返回结果，请重试",
    NOVOICE: "未检测到语音，请靠近麦克风重说",
    empty: "未识别到内容，请重试",
    unavailable: "本机无可用语音引擎（vivo 可开启 Jovi 语音，或安装语音引擎）",
    "mic-permission": "未授权麦克风，请点下方按钮授权",
    EX: "启动异常"
  };
  clearVoiceTimers();
  voice.active = false;
  setSpaceVoicing(false);
  $("#voStatus").textContent = "语音不可用";
  $("#voDbg").textContent = "错误码 " + code + " · " + (msg || "");
  $("#voPartial").textContent = ERR[code] || ("识别失败（错误码 " + code + "）");
  $("#voPerm").style.display = "";
  renderWave(0);
  L("语音错误 " + code + " " + (msg || ""));
}

/* ============================================================
 * 设置 / 主题 / 诊断
 * ============================================================ */
function applySettings() {
  var kb = $("#kb");
  kb.classList.toggle("theme-dark", settings.theme === "dark");
  kb.classList.toggle("theme-neon", settings.theme === "neon");
  kb.classList.toggle("blur-off", !settings.blur || SOFT_GPU);
  $all(".toggle").forEach(function (t) {
    t.classList.toggle("on", !!settings[t.getAttribute("data-set")]);
  });
  $all("[data-theme]").forEach(function (b) {
    b.classList.toggle("sel", b.getAttribute("data-theme") === settings.theme);
  });
  var tr = $("#trBtn"); if (tr) tr.classList.toggle("on", settings.trans);
}
function collectDiag() {
  var d = {};
  bridge(function (b) { if (b.diagnostics) { try { d = JSON.parse(b.diagnostics()); } catch (e) {} } });
  d.app = "云五笔·玻璃键盘 lite v2.2";
  d.mode = state.mode; d.panel = state.panel; d.shift = state.shift;
  d.clips = state.clips.length;
  d.settings = settings;
  d.recentWords = state.recent.length;
  d.log = LOG_BUF.slice(-70);
  return JSON.stringify(d, null, 2);
}
function refreshDiagView() { $("#diagView").textContent = collectDiag(); }

/* 语音引擎手动选择（识别不出结果时绕过自动打分）；列表来自 Java engineList() */
function renderEngineList() {
  var box = $("#engineList");
  if (!box) return;
  box.innerHTML = "";
  var list = [], manual = "";
  bridge(function (b) {
    if (b.engineList) { try { list = JSON.parse(b.engineList()); } catch (e) {} }
    if (b.getEngine) { try { manual = b.getEngine() || ""; } catch (e) {} }
  });
  function engBtn(label, val, sel) {
    var b = el("button", "set-action" + (sel ? " sel" : ""));
    b.setAttribute("type", "button"); b.textContent = label;
    b.addEventListener("click", function () {
      playClick();
      bridge(function (bb) { bb.setEngine(val); });
      toast(val ? "已指定语音引擎，长按空格重试" : "已改为自动选择引擎");
      setTimeout(renderEngineList, 200);
    });
    box.appendChild(b);
  }
  engBtn("自动（国内引擎优先）", "", !manual);
  list.forEach(function (e) { engBtn(e.l, e.c, !!manual && manual === e.c); });
  if (!list.length) {
    var tip = el("div", "set-group");
    tip.textContent = "未枚举到系统语音引擎：可开启 vivo Jovi，或安装讯飞语记/百度等语音引擎";
    box.appendChild(tip);
  }
}

/* ============================================================
 * Java → JS 回调
 * ============================================================ */
// 键盘（重新）开始输入 / 窗口每次重新显示：清空临时态、恢复默认；密码框走安全规范
function resetForNewInput() {
  state.buf = ""; state.enPre = ""; state.cands = []; state.ctxCands = [];
  state.calc = ""; state.calcDone = false;
  var secret = state.isPassword || state.numPassword;
  // 文本密码框不自动大写（默认小写，可 Shift 切换）；普通框默认大写
  state.shift = state.isPassword ? "lower" : "upper";
  document.body.classList.toggle("pw-mode", !!state.isPassword);
  document.body.classList.toggle("numpw-mode", !!state.numPassword);
  // 数字密码 → 数字盘；其余 → 字母主面板，不残留子面板
  showPanel(state.numPassword ? "number" : "letters");
  renderCalc();
  renderCands(); renderLetterFaces();
  if (secret) { state.ctxCands = []; renderCands(); }  // 密码框：不联想、不翻译、不读剪贴板
  else { pullClip(); scheduleCtx(); }
  L(secret ? "密码框：关闭联想/翻译/自动大写" : "恢复默认状态");
}
window.KB = {
  onStartInput: function (pwd, numPwd, numeric) {
    state.isPassword = !!pwd; state.numPassword = !!numPwd; state.numeric = !!numeric;
    resetForNewInput();
  },
  onWindowShown: function () { resetForNewInput(); setTimeout(applyLayout, 30); },
  onSelection: function () { L("onSelection"); scheduleCtx(); },
  voiceState: function (s) {
    L("voiceState:" + s);
    if (s === "ready") $("#voStatus").textContent = "请说话…";
    else if (s === "listening") { $("#voStatus").textContent = "正在聆听…"; onVoiceHeard(); }
    else if (s === "processing") $("#voStatus").textContent = "识别中…";
  },
  voiceLevel: function (rms) {
    var dot = $("#voDot");
    if (dot) { var sc = 1 + Math.min(0.55, (rms / 100) * 0.9); dot.style.transform = "scale(" + sc + ")"; }
    if (rms > 6) onVoiceHeard();
    if (voice.active) renderWave(rms);
  },
  voicePartial: function (t) {
    L("partial:" + t);
    if (voice.active) $("#voPartial").textContent = t;
  },
  voiceResult: function (t) {
    L("voiceResult:" + t + " cancel=" + voice.cancel);
    clearVoiceTimers();
    voice.active = false;
    setSpaceVoicing(false);
    $("#voiceOverlay").classList.remove("show");
    if (voice.cancel) { voice.cancel = false; return; }
    if (t) commitText(t);
  },
  voiceError: function (code, msg) { voiceError(code, msg); },
  /* 当前引擎失败、Java 已自动切到下一个：重置聆听态，提示重说 */
  voiceRetry: function (n, m) {
    L("voiceRetry " + n + "/" + m);
    voice.heard = false;
    voice.active = true;
    voice.cancel = false;
    $("#voPerm").style.display = "none";
    $("#voPartial").textContent = "";
    $("#voStatus").textContent = "已切换引擎(" + n + "/" + m + ")，请重说";
    renderWave(6);
    clearVoiceTimers();
    armVoiceTimers();
  }
};

/* ============================================================
 * 初始化
 * ============================================================ */
function bindStatic() {
  $("#modeBtn").addEventListener("click", modeBtnTap);
  $("#voClose").addEventListener("click", function () {
    if (voice.active) cancelVoice();
    else { voice.active = false; voice.cancel = true; $("#voiceOverlay").classList.remove("show"); bridge(function (b) { b.stopVoice(); }); }
  });
  $("#voPerm").addEventListener("click", function () { bridge(function (b) { b.openSetup(); }); });
  $("#setMic").addEventListener("click", function () {
    bridge(function (b) { b.openSetup(); });
    if (!isApk()) toast("请在安卓真机授权麦克风");
    setTimeout(refreshDiagView, 800);
  });
  $("#diagCopy").addEventListener("click", function () {
    var txt = collectDiag();
    bridge(function (b) { b.copy(txt); });
    if (!isApk()) { try { navigator.clipboard.writeText(txt); } catch (e) {} }
    toast("诊断信息已复制，可粘贴发给开发者");
  });
  $("#diagShare").addEventListener("click", function () {
    var txt = collectDiag();
    bridge(function (b) { b.share("【云五笔·玻璃键盘 v2.2 问题反馈】\n" + txt); });
    if (!isApk()) toast("真机上可调起微信/QQ/邮件分享");
  });
}

/* 尺寸自适应：键宽驱动键高（字母键 宽:高=3:4，功能键 1:1） */
function applyLayout() {
  var W = window.innerWidth || 360;
  var hgap = 4;   // 水平键间隙
  var vgap = 8;   // 垂直行间隙（在原基础上加大一倍）
  var kw = (W - 12 - 9 * hgap) / 10;   // 面板左右padding 6+6，10键9间隙
  var kh = Math.round(kw * 16 / 9);    // 字母键高：宽:高=3:4 基础上再高 1/3
  var fs = Math.round(kw * 1.5);      // 功能键方形（flex1.5 → 宽=1.5kw）
  var panelsH = 9 + kh * 4 + fs + vgap * 4;  // 字母盘 4行kh(rowNum,1,2,3) + 底排fs
  var root = document.documentElement;
  root.style.setProperty("--kh-letter", kh + "px");
  root.style.setProperty("--fs", fs + "px");
  root.style.setProperty("--panels-h", panelsH + "px");
  root.style.setProperty("--key-gap", hgap + "px");
  root.style.setProperty("--row-gap", vgap + "px");
  root.style.setProperty("--kw", Math.round(kw) + "px");
  root.style.setProperty("--row-indent", Math.round((kw + hgap) / 2) + "px");
  root.style.setProperty("--safe-b", "8px");
  var total = 42 + 32 + panelsH + 8;  // candbar42 + toolbar32 + panels + 底部安全区
  bridge(function (b) { if (b.updateHeight) b.updateHeight(total); });
  L("layout W=" + W + " kw=" + kw.toFixed(1) + " kh=" + kh + " fs=" + fs + " total=" + total);
}
window.addEventListener("resize", applyLayout);

function init() {
  L("app init v2.2, bridge=" + isApk());
  try {
    SOFT_GPU = !!(isApk() && window.AndroidBridge.softGpu && window.AndroidBridge.softGpu());
    if (SOFT_GPU) {
      document.body.classList.add("soft-gpu");
      L("检测到软件GPU：关背景模糊 + 分页改页切换（真机硬件GPU保持玻璃模糊与手拖动）");
    }
  } catch (e) {}
  renderLetters();
  renderNumber();
  renderPunct();
  renderEmoji();
  renderPhrase();
  renderClip();
  updateModeUI();
  applySettings();
  renderCands();
  bindStatic();
  applyLayout();
  setTimeout(applyLayout, 350);   // 大词库解析后窗口稳定，补报高度（治首次 insets=0）
  setTimeout(applyLayout, 1000);
  $("#verLabel").textContent = "云五笔·玻璃键盘 lite v2.2 · 词库源自 极点五笔(Apache-2.0) 与 rime-wubi(LGPL-3.0)";
  if (!isApk()) {
    document.body.classList.add("preview");
    toast("浏览器预览：点击输入框获得焦点后试用");
  }
  L("初始化完成");
  setTimeout(buildSug, 0); // 联想索引延迟构建，不阻塞首屏键盘显示
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
