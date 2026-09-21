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
window.addEventListener("unhandledrejection", function (e) { var r = e.reason; L("未捕获Promise:" + (r && r.message ? r.message : r)); });

/* ---------- 性能环（卡顿/击键耗时） + 操作轨迹环（脱敏：只记动作不记内容，密码框不记录） ---------- */
var PERF = { longtask: [], keyMs: [], maxKey: 0 };
try {
  if (window.PerformanceObserver) {
    new PerformanceObserver(function (list) {
      list.getEntries().forEach(function (en) {
        PERF.longtask.push(Math.round(en.duration));
        if (PERF.longtask.length > 20) PERF.longtask.shift();
      });
    }).observe({ entryTypes: ["longtask"] });
  }
} catch (e) {}
function markKey(ms) { PERF.keyMs.push(ms); if (PERF.keyMs.length > 30) PERF.keyMs.shift(); if (ms > PERF.maxKey) PERF.maxKey = ms; }
var TRACE = [];
function TR(act) { if (state && state.isPassword) return; TRACE.push((Date.now() % 100000) + " " + act); if (TRACE.length > 40) TRACE.shift(); }

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
function vib(ms) { if (settings.vib) bridge(function (b) { b.vibrate(ms && ms > 0 ? ms : 25); }); }
var toastTimer = null;
function toast(msg) {
  var t = document.querySelector(".toast");
  if (!t) { t = el("div", "toast"); document.body.appendChild(t); }
  t.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(function () { t.remove(); }, 1800);
}

/* ---------- 持久化设置 / 状态 ---------- */
var DEFAULT_SETTINGS = { sug: true, trans: false, sound: true, vib: true, blur: true, theme: "",
  pyDouble: false, dpScheme: "flypy", telemetry: false };
var settings = load("cw_settings", DEFAULT_SETTINGS);
if (!localStorage.getItem("cw_theme_migrated_v27")) {   // v2.7：回归浅色清透玻璃，一次性把强迁的深色还原
  settings.theme = "";
  localStorage.setItem("cw_theme_migrated_v27", "1");
  save("cw_settings", settings);
}
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
  userMode: "smart",    // 用户在普通框的模式偏好（密码框临时切英文，退出恢复）
  segLen: 0,            // 文本框划词已处理长度（只统计新增）
  clipDrop: load("cw_clipdrop", ""),  // 剪贴板最近点选（💧动态置顶标记）
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
  shiftLock: false,     // 上档键态：true=切到英文大写输出，再按恢复原模式（中文/英文）
  shiftPrevMode: "smart",
  before: "",           // 光标前文本（句首/联想/翻译用）
  recent: load("cw_recent", []),
  clips: load("cw_clips", []),
  lpZh: (localStorage.getItem("cw_lpZh") || "，"),
  rpZh: (localStorage.getItem("cw_rpZh") || "。"),
  lpEn: (localStorage.getItem("cw_lpEn") || ","),
  rpEn: (localStorage.getItem("cw_rpEn") || ".")
};
function isZh() { return !state.shiftLock && state.mode !== "en"; }

/* ---------- 五笔数据（25 个本地 JSON 分片，启动同步加载；JSON.parse 运行时构建，兼容旧 WebView） ---------- */
var WUBI = (function () {
  var idx = {}, failed = [];
  "abcdefghijklmnopqrstuvwxy".split("").forEach(function (L) {
    try {
      var x = new XMLHttpRequest();
      x.open("GET", "lite/" + L + ".json", false);   // 同步：本地 file，毫秒级
      x.send(null);
      if (x.responseText) {
        var part = JSON.parse(x.responseText);
        Object.keys(part).forEach(function (c) { idx[c] = part[c]; });
      } else failed.push(L);
    } catch (e) { failed.push(L); }
  });
  var nCodes = Object.keys(idx).length, nItems = 0;
  Object.keys(idx).forEach(function (c) { nItems += idx[c].length; });
  window.WUBI_META = { codes: nCodes, items: nItems, failed: failed, ua: navigator.userAgent };
  return idx;
})();
/* 用户词学习：单字全码表（给用户上屏的多字词生成五笔编码）+ 用户私有白名单（精确匹配、不连锁、上限、可清空） */
var UC = {};
Object.keys(WUBI).forEach(function (code) {
  if (code.length < 3) return;
  (WUBI[code] || []).forEach(function (o) {
    if (o.t.length === 1 && (!UC[o.t] || code.length > UC[o.t].length)) UC[o.t] = code;
  });
});
/* 前缀索引：构建一次，替代 queryWubi 每次全量遍历；异步执行不阻塞首屏 */
var PREFIX_INDEX = {}, PREFIX_READY = false;
function buildPrefixIndex() {
  var codes = Object.keys(WUBI), idx = 0, t = Date.now();
  function chunk() {
    var guard = 0;
    while (idx < codes.length && guard < 400) {
      var code = codes[idx++]; guard++;
      if (code.length < 2) continue;
      var words = WUBI[code] || [];
      for (var pl = code.length - 1; pl >= 1; pl--) {
        var p = code.slice(0, pl), arr = PREFIX_INDEX[p] || (PREFIX_INDEX[p] = []);
        for (var i = 0; i < words.length && arr.length < 60; i++) arr.push(words[i]);
      }
    }
    if (idx < codes.length) schedule(); else finalize();
  }
  function schedule() {
    if (window.requestIdleCallback) requestIdleCallback(chunk, { timeout: 300 });
    else setTimeout(chunk, 16);
  }
  function finalize() {
    Object.keys(PREFIX_INDEX).forEach(function (p) {
      var m = {}, out = [];
      PREFIX_INDEX[p].sort(function (a, b) { return (b.f || 0) - (a.f || 0); });
      PREFIX_INDEX[p].forEach(function (o) { if (!m[o.t] && out.length < 12) { m[o.t] = 1; out.push(o); } });
      PREFIX_INDEX[p] = out;
    });
    PREFIX_READY = true;
    L("前缀索引构建 " + (Date.now() - t) + "ms（空闲分片，不阻塞击键）");
  }
  schedule();
}
setTimeout(buildPrefixIndex, 60);
/* ===== 本地高频词（v3.1）：周窗统计 + 500封顶 + 缓存优先；替代旧 USER_WORDS ===== */
var LOCAL_FREQ = load("cw_local_freq", {});    // {code:[{t:词,c:周内次数,d:最后日天序号}]}
var LOCAL_DAY = Math.floor(Date.now() / 86400000);
var LOCAL_TODAY = load("cw_local_today", { d: LOCAL_DAY, n: 0 });   // 今日新增词数
if (LOCAL_TODAY.d !== LOCAL_DAY) LOCAL_TODAY = { d: LOCAL_DAY, n: 0 };
var learnMark = load("cw_learnmark", {});   // 新增词标记：在剪贴板中以黄橙色背景标识
var LOCAL_CAP = 500, FREQ_HOT = 50, WEEK_DAYS = 7;
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

/* ---------- 语境整句联想（方案3：通读整句做语境判断，给后续整句；不组词、不造词） ---------- */
var SCENES = window.CONTEXT_SCENES || [];
function contextSug(before) {
  if (!settings.sug || !before) return [];
  var parts = before.split(/[。！？!?\n；;]/);
  var last = parts[parts.length - 1] || "";
  var probe = last.length >= 4 ? last : before.slice(-40);
  var best = null, bs = 0;
  for (var i = 0; i < SCENES.length; i++) {
    var sc = SCENES[i], score = 0;
    for (var j = 0; j < sc.k.length; j++) { var kw = sc.k[j]; if (probe.indexOf(kw) >= 0) score += kw.length >= 2 ? 2 : 1; }
    if (score > bs) { bs = score; best = sc; }
  }
  if (!best) return [];
  var out = [];
  for (var k = 0; k < best.s.length && out.length < 3; k++) {
    var s = best.s[k];
    if (before.indexOf(s) === -1) out.push(s);
  }
  return out;
}

/* ---------- 中文词 → 符号 / 表情（用户固化规则） ----------
 * 输入该中文词的五笔编码时，候选里同步给出对应符号/表情，点选即上屏 */
var SYM_CODE = null;
var SYM_CODE = {
  加: "lk", 减: "udg", 乘: "tux", 除: "bw",
  等于: "tfgf", 等号: "tfkg", 括号: "rtkg",
  百分之: "dwpp", 千分之: "twp",
  大于: "ddgf", 小于: "ihgf", 不等于: "itg",
  笑: "ttd", 哭: "kkdu", 爱: "ep", 心: "ny",
  花: "aw", 星: "jtg", 火: "o", 水: "i",
  太阳: "dybj", 月亮: "eeyp", 赞: "tfqm"
};
function symbolCode(w) { return SYM_CODE[w]; }   // 编码构建期写死，零运行时遍历
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
/* ===== 云端词库（词组 + 被砍单字按需加载；端侧只留简码+常用字，离线/无网降级为端侧）===== */
var CLOUD_REF = "v4.0";   // 云端资源版本（与 git tag 对应；jsDelivr 对新 tag 首次访问即回源最新，无缓存问题）
var CLOUD_BASE = "https://cdn.jsdelivr.net/gh/zsdili/CloudWubi-Glass-Keyboard@" + CLOUD_REF + "/cloud/";
var GITEE_RAW = "https://gitee.com/zsdili/CloudWubi-Glass-Keyboard/raw/" + CLOUD_REF + "/";
/* 云端 JSON：jsDelivr 主源 → Gitee 备用源，带超时竞速；弱网/国内慢时不长期 pending，最终 null 触发离线降级 */
/* 云端 JSON：Gitee（国内快）与 jsDelivr 并行竞速，任一先成功即用；整体超时后 null 触发离线降级 */
function fetchCloudJson(rel, timeoutMs) {
  var urls = [
    GITEE_RAW + rel,                                                            // 国内优先
    "https://cdn.jsdelivr.net/gh/zsdili/CloudWubi-Glass-Keyboard@" + CLOUD_REF + "/" + rel
  ];
  return new Promise(function (resolve) {
    var done = false, fails = 0, overall;
    function finish(j) { if (!done) { done = true; clearTimeout(overall); resolve(j); } }
    overall = setTimeout(function () { finish(null); }, timeoutMs);
    urls.forEach(function (u) {
      fetch(u).then(function (r) { if (!r.ok) throw new Error("http"); return r.json(); })
        .then(function (j) { finish(j); })
        .catch(function () { if (++fails >= urls.length) finish(null); });
    });
  });
}
var CLOUD_SVG = '<svg viewBox="0 0 24 24" width="11" height="11"><path d="M7 18.2a4 4 0 0 1-.5-7.9 5.6 5.6 0 0 1 10.7-1.1 3.9 3.9 0 0 1-.3 7.7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>';
var cloudIndex = {};        // code -> [{t,f}]
var shardPending = {};     // prefix -> Promise
function ensureShard(prefix) {
  if (shardPending[prefix]) return shardPending[prefix];
  shardPending[prefix] = fetchCloudJson("cloud/" + prefix + ".json", 2600).then(function (j) {
    if (j) Object.keys(j).forEach(function (code) {
      (cloudIndex[code] = cloudIndex[code] || []).push.apply(cloudIndex[code],
        j[code].map(function (a) { return { t: a[0], f: a[1] }; }));
    });
    return j ? 1 : 0;
  });
  return shardPending[prefix];
}

function queryWubi(code) {
  var seen = {}, exact = [], prefix = [];
  function add(o, into, src) {
    if (/[㐀-䶿]/.test(o.t)) return;
    var ex = seen[o.t];
    if (ex) {                                   // 同词多来源：合并更高权重，本地学习升级来源
      if ((o.f || 0) > ex.f) ex.f = o.f || 0;
      if (o.fire) ex.fire = true;
      if (src === "local") ex.src = "local";
      return;
    }
    var no = { t: o.t, f: o.f || 0, src: src || "base", fire: !!o.fire };
    seen[o.t] = no; into.push(no);
  }
  var cLen = code.length;
  if (code.indexOf("z") >= 0) {
    var re = new RegExp("^" + code.replace(/z/g, ".") + "$");
    Object.keys(WUBI).forEach(function (k) { if (re.test(k)) (WUBI[k] || []).forEach(function (o) { add(o, prefix); }); });
  } else {
    (WUBI[code] || []).forEach(function (o) { add(o, exact, "base"); });   // 端侧精确（简码/常用字）
    (cloudIndex[code] || []).forEach(function (o) { add(o, exact, "cloud"); }); // 云端精确（词组/被砍单字，已缓存则即时）
    (LOCAL_FREQ[code] || []).forEach(function (e) { add({ t: e.t, f: 1.05e7 + e.c * 500, fire: (e.dc || 0) >= FREQ_HOT }, exact, "local"); });  // 本地高频优先；当天≥50加🔥
    if (cLen < 4) (PREFIX_INDEX[code] || []).forEach(function (o) { add(o, prefix); });  // 前缀补全：O(1)查预建索引
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
      var la = a.src === "local" ? 1 : 0, lb = b.src === "local" ? 1 : 0;
      if (la !== lb) return lb - la;                                  // 本地缓存优先（个人词加速）
      if (a.t.length !== b.t.length) return a.t.length - b.t.length;   // 通用词：二字→三字→四字
      return b.f - a.f;                                                // 同长度按高频
    });
  }
  multiSort(exactMulti); multiSort(prefixMulti);
  var list = exactSingle.concat(prefixSingle, exactMulti, prefixMulti);   // 统一按固化排序：最近上屏/高频单字 → 二字词 → 三字词 → 四字词（全码单字不被词组挤出第一页）
  // 编码到对应中文词时，符号/表情紧跟该词插入；词不在列表则放首选之后
  SYMBOL_WORDS.forEach(function (sw) {
    var wc = symbolCode(sw.w);
    if (wc && (code === wc || code.indexOf(wc) === 0) && list.every(function (o) { return o.t !== sw.out; })) {
      var wi = -1, i;
      for (i = 0; i < list.length; i++) { if (list[i].t === sw.w) { wi = i; break; } }
      list.splice(wi >= 0 ? wi + 1 : Math.min(1, list.length), 0, { t: sw.out, f: 0, src: "sym" });
    }
  });
  return list.slice(0, 30).map(function (o) { return { t: o.t, src: o.src, fire: !!o.fire }; });
}

/* ================= 拼音引擎（全拼 / 双拼 / 简拼，与五笔混打） ================= */
var PYSYL = {}, PYFULL = {}, PYJIAN = {}, PYDP = {}, PY_META = {};
(function () {
  function load(f) {
    try {
      var x = new XMLHttpRequest(); x.open("GET", "py/" + f, false); x.send(null);
      return x.responseText ? JSON.parse(x.responseText) : null;
    } catch (e) { return null; }
  }
  PYSYL = load("syl.json") || {};
  PYFULL = load("full.json") || {};
  PYJIAN = load("jian.json") || {};
  function loadDp(s) { PYDP = load("dp_" + s + ".json") || {}; PY_META.dp = Object.keys(PYDP).length; }
  loadDp(settings.dpScheme || "flypy");
  window.reloadDp = loadDp;
  window.PY_META = PY_META;
  PY_META.syl = Object.keys(PYSYL).length;
  PY_META.full = Object.keys(PYFULL).length;
  PY_META.jian = Object.keys(PYJIAN).length;
})();
var SYL_SET = {};
Object.keys(PYSYL).forEach(function (s) { SYL_SET[s] = 1; });
var PYCLOUD_BASE = "https://cdn.jsdelivr.net/gh/zsdili/CloudWubi-Glass-Keyboard@" + CLOUD_REF + "/cloud_py/";
var pyCloudFull = {}, pyCloudJian = {}, pyPending = {};
function ensurePyShard(kind, letter) {
  var key = kind + letter;
  if (pyPending[key]) return pyPending[key];
  pyPending[key] = fetchCloudJson("cloud_py/" + kind + "/" + letter + ".json", 2200).then(function (j) {
    if (j) Object.keys(j).forEach(function (k) {
      var tgt = kind === "full" ? pyCloudFull : pyCloudJian;
      (tgt[k] = tgt[k] || []).push.apply(tgt[k], j[k]);
    });
    return j ? 1 : 0;
  });
  return pyPending[key];
}
function splitPinyin(buf) {
  var n = buf.length, memo = {};
  function go(i) {
    if (i === n) return [[]];
    if (memo[i]) return memo[i];
    var out = [], j;
    for (j = i + 1; j <= Math.min(n, i + 6); j++) {
      var seg = buf.slice(i, j);
      if (SYL_SET[seg]) go(j).forEach(function (rest) { if (out.length < 24) out.push([seg].concat(rest)); });
    }
    memo[i] = out; return out;
  }
  return go(0);
}
function dpDecode(buf) {
  var seq = [];
  for (var k = 0; k + 1 < buf.length; k += 2) {
    var sy = PYDP[buf.slice(k, k + 2)];
    if (!sy || !sy.length) return seq;
    seq.push(sy[0]);
  }
  return seq;
}
/* 音节级容错（方言/漏字母）：精确切分无词时，允许每音节编辑距离≤1、整条总距离≤dcap，映射到合法音节序列 */
function editDist(a, b) {
  var m = a.length, n = b.length, i, j, d = [];
  for (i = 0; i <= m; i++) d.push([i]);
  for (j = 1; j <= n; j++) d[0][j] = j;
  for (i = 1; i <= m; i++)
    for (j = 1; j <= n; j++)
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[m][n];
}
var SYL_LIST = Object.keys(SYL_SET);
function nearSyllables(seg) {
  if (SYL_SET[seg]) return [{ syl: seg, d: 0 }];
  if (seg.length < 2) return [];
  var out = [], got = {};
  for (var i = 0; i < SYL_LIST.length; i++) {
    var sy = SYL_LIST[i];
    if (Math.abs(sy.length - seg.length) > 1) continue;
    var dd = editDist(seg, sy);
    if (dd <= 1 && !got[sy]) { got[sy] = 1; out.push({ syl: sy, d: dd }); }
  }
  return out;
}
function fuzzySyllableSeq(buf, dcap) {
  var n = buf.length, K = 60;
  var dp = [];
  for (var i = 0; i <= n; i++) dp.push([]);
  dp[0] = [{ seq: [], d: 0 }];
  function prune(arr, lim) {
    arr.sort(function (a, b) { return a.d - b.d; });
    var got = {}, out = [];
    for (var k = 0; k < arr.length && out.length < lim; k++) {
      var key = arr[k].seq.join("");
      if (!got[key]) { got[key] = 1; out.push(arr[k]); }
    }
    return out;
  }
  for (var p = 0; p < n; p++) {
    dp[p] = prune(dp[p], K);
    for (var L = 1; L <= Math.min(6, n - p); L++) {
      var seg = buf.slice(p, p + L), j = p + L;
      var cands = SYL_SET[seg] ? [{ syl: seg, d: 0 }] : nearSyllables(seg);
      dp[p].forEach(function (prev) {
        cands.forEach(function (nr) {
          var nd = prev.d + nr.d;
          if (nd <= dcap) dp[j].push({ seq: prev.seq.concat(nr.syl), d: nd });
        });
      });
    }
  }
  return prune(dp[n], 40);
}
function queryPinyin(buf) {
  var multi = [], homo = [], syms = [], prefix = [];
  var seenM = {}, seenH = {}, seenS = {}, seenP = {};
  function pushTo(arr, seen, t, f) {
    if (seen[t] !== undefined) { if (f > seen[t]) seen[t] = f; return; }
    seen[t] = f; arr.push({ t: t, f: f });
  }
  var useDp = !!settings.pyDouble;
  var seqs = [];
  if (useDp) { var s0 = dpDecode(buf); if (s0.length) seqs.push(s0); }
  else seqs = splitPinyin(buf);
  seqs.forEach(function (seq) {
    var str = seq.join("");
    (PYFULL[str] || []).concat(pyCloudFull[str] || []).forEach(function (o) {
      if (o.sym) pushTo(syms, seenS, o.t, o.f || 0);
      else if (o.t.length >= 2) pushTo(multi, seenM, o.t, o.f || 0);
      else pushTo(homo, seenH, o.t, o.f || 0);
    });
    if (seq.length === 1) (PYSYL[seq[0]] || []).forEach(function (o) {
      pushTo(homo, seenH, o.t, o.f || 0);
    });
  });
  if (!useDp) (PYJIAN[buf] || []).concat(pyCloudJian[buf] || []).forEach(function (o) {
    if (o.sym) pushTo(syms, seenS, o.t, o.f || 0);
    else if (o.t.length >= 2) pushTo(multi,seenM, o.t, o.f || 0);
  });
  if (!useDp && !seqs.length) {
    for (var k2 = buf.length - 1; k2 >= 1; k2--) {
      var head = buf.slice(0, k2), tail = buf.slice(k2);
      if (splitPinyin(head).length) {
        Object.keys(SYL_SET).forEach(function (sy) {
          if (sy.indexOf(tail) === 0 && prefix.length < 6)
            (PYSYL[sy] || []).slice(0, 1).forEach(function (o) { pushTo(prefix, seenP, o.t, 0); });
        });
        break;
      }
    }
    Object.keys(PYFULL).forEach(function (k3) {
      if (k3.indexOf(buf) === 0 && prefix.length < 10)
        (PYFULL[k3] || []).slice(0, 1).forEach(function (o) { if (!o.sym) pushTo(prefix, seenP, o.t, 0); });
    });
  }
  /* 精确切分完全无词 → 音节级容错（漏字母/方言），总距离≤2，词频为主、纠错距离轻微降权 */
  var fuzzy = [];
  if (!useDp && !multi.length && !homo.length && !syms.length && buf.length >= 3 && buf.length <= 7) {
    var seenF = {};
    fuzzySyllableSeq(buf, 2).forEach(function (r) {
      var str = r.seq.join("");
      (PYFULL[str] || []).forEach(function (o) {
        if (!o.sym && o.t.length >= 2 && seenF[o.t] === undefined) {
          seenF[o.t] = 1;
          fuzzy.push({ t: o.t, f: (o.f || 0) - r.d * 50 });
        }
      });
    });
    fuzzy.sort(function (a, b) { return b.f - a.f; });
  }
  multi.sort(function (a, b) { return b.f - a.f; });
  homo.sort(function (a, b) { return b.f - a.f; });   // 同音字按词频：常用字（你）稳定首位，不受云端/到达时序影响
  var out = [];
  fuzzy.slice(0, 8).forEach(function (o) { out.push({ t: o.t, src: "py-fuzzy" }); });
  multi.slice(0, 12).forEach(function (o) { out.push({ t: o.t, src: "py" }); });
  homo.slice(0, 10).forEach(function (o) { out.push({ t: o.t, src: "py" }); });
  syms.forEach(function (o) { out.push({ t: o.t, src: "sym" }); });
  prefix.slice(0, 6).forEach(function (o) { out.push({ t: o.t, src: "py-pre" }); });
  return out.slice(0, 30);
}
/* 混打候选合并：五笔在前、拼音在后，同词去重 */
function mergeWP(w, p) {
  var seen = {}, out = [];
  w.slice(0, 14).forEach(function (o) {
    var t = (typeof o === "string") ? o : o.t;
    if (seen[t]) return; seen[t] = 1; out.push(o);
  });
  p.slice(0, 14).forEach(function (o) {
    var t = (typeof o === "string") ? o : o.t;
    if (seen[t]) return; seen[t] = 1; out.push(o);
  });
  return out.slice(0, 28);
}
/* 触发拼音云端分片（按全拼首字母；双拼按解码音节首字母） */
function schedulePyCloud(buf) {
  var letters = [];
  if (settings.pyDouble) {
    for (var i = 0; i + 2 <= buf.length; i += 2) {
      var sy0 = PYDP[buf.slice(i, i + 2)];
      if (sy0 && sy0[0]) letters.push(sy0[0][0]);
    }
  } else {
    var ss = splitPinyin(buf);
    if (ss.length) ss[0].forEach(function (s) { letters.push(s[0]); });
    else if (buf[0]) letters.push(buf[0]);
  }
  letters = Array.from(new Set(letters));
  if (!letters.length) return Promise.resolve(0);
  var tasks = [];
  letters.forEach(function (l) { tasks.push(ensurePyShard("full", l)); tasks.push(ensurePyShard("jian", l)); });
  return Promise.all(tasks);
}
window.queryPinyin = queryPinyin; window.queryWubi = queryWubi; window.mergeWP = mergeWP;
window.calcValue = calcValue;
window.ensureShard = ensureShard; window.ensurePyShard = ensurePyShard; window.splitPinyin = splitPinyin;
/* 开发期只读诊断钩子：读取运行态/本地词/合成编码（不收集、不外传；用于回归与用户反馈诊断）*/
window.__kb = {
  state: function () { return { buf: state.buf, mode: state.mode, shift: state.shift,
    beforeTail: state.before.slice(-30),
    cands: (state.cands || []).map(function (c) { return typeof c === "string" ? c : { t: c.t, src: c.src, fire: !!c.fire }; }) }; },
  local: function () { var o = []; Object.keys(LOCAL_FREQ).forEach(function (c) { LOCAL_FREQ[c].forEach(function (e) { o.push({ code: c, t: e.t, c: e.c, dc: e.dc }); }); }); return o; },
  code: function (t) { return tryUserCode(t); },
  today: function () { return LOCAL_TODAY; },
  /* 自动化动作（开发期回归用；不收集、不外传）*/
  commit: function (t) { commitText(t); return state.before.slice(-20); },
  pick: function () { if (state.cands && state.cands.length) { var f = state.cands[0]; pickCand(typeof f === "string" ? f : f.t); return 1; } return 0; },
  segNow: function () { segmentAndLearn(); return { segLen: state.segLen }; }
};

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
  a:"~", s:"@", d:"#", f:"$", g:"%", h:"&", j:"*", k:"(", l:")",
  z:"'", x:"/", c:"-", v:"_", b:":", n:";", m:"、"
};
/* 英文模式：第一行换成英文标点（< > { } [ ] " ^ \ |），第二三行是通用符号、与中文模式一致 */
var KEY_PUNCT_EN = {
  q:"<", w:">", e:"{", r:"}", t:"[", y:"]", u:'"', i:"^", o:"\\", p:"|",
  m:"."
};
function keyPunct(c) { if (isZh()) return KEY_PUNCT[c]; return KEY_PUNCT_EN[c] || KEY_PUNCT[c]; };
function letterKey(c) {
  var k = el("button", "key letter-key");
  k.setAttribute("type", "button"); k.setAttribute("data-letters", c);
  var pp = el("span", "k-punct"); pp.textContent = keyPunct(c) || "";
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
  r4.appendChild(key("enter", { "data-act": "enter", "aria-label": "回车" }, "↩"));
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
  if (state.shift === "caps") return c.toUpperCase();   // 大写锁定：全部大写
  if (state.shift === "lower") return c;                // 小写：全部小写
  if (state.isPassword) return c;                      // 密码 + 智能态：不自动句首大写
  return isSentStart() ? c.toUpperCase() : c;          // 智能态：句首大写、句中小写
}
function enCase(word) {
  if (state.shift === "caps") return word.toUpperCase();
  if (state.shift === "lower") return word;
  if (state.isPassword) return word;
  if (isSentStart() && word) return word[0].toUpperCase() + word.slice(1);
  return word;
}
function renderLetterFaces() {
  var upper = isUpper();
  $all("[data-letters]").forEach(function (k) {
    var c = k.getAttribute("data-letters");
    var lt = k.querySelector(".k-letter");
    if (lt) lt.textContent = upper ? c.toUpperCase() : c;
    var pp = k.querySelector(".k-punct");
    if (pp) pp.textContent = keyPunct(c) || "";
  });
  var sk = $("#shiftKey");
  if (sk) {
    sk.textContent = "⇧";
    sk.className = "key fn shift-" + state.shift + (state.shiftLock ? " shift-lock" : "");
    sk.setAttribute("data-act", "shift");
  }
}
function punctToggleKey(id) {
  var k = el("button", "key punct-toggle");
  k.setAttribute("type", "button"); k.id = id;
  var a = el("span", "pt-alt"); var m = el("span", "pt-main");
  k.appendChild(a); k.appendChild(m);   // 备用（！/？）小字在上、主标点（，/。）在下（与字母键上标位置一致）
  return k;
}
function renderPunctToggles() {
  var lp = $("#lpunct .pt-main"), la = $("#lpunct .pt-alt");
  var rp = $("#rpunct .pt-main"), ra = $("#rpunct .pt-alt");
  var Lp = punctPair("l"), Rp = punctPair("r");
  lp.textContent = Lp[0]; la.textContent = Lp[1];
  rp.textContent = Rp[0]; ra.textContent = Rp[1];
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
  // 右列：退格 / @ / 空格（9 右，单击上屏默认备选）
  g.appendChild(npK("⌫", "fnr", { "data-act": "del", "aria-label": "退格" }, 1, 5));
  g.appendChild(npK("@", "fnr", { "data-act": "commitAt" }, 2, 5));
  g.appendChild(npK("空格", "np-space", { "data-act": "npSpace", "aria-label": "空格" }, 3, 5));
  // 底行：返回 / ％（0 左）/ 0（8 正下）/ 小数点（0 右）/ 回车；符号切换走工具栏
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
  } else if (/[+−×÷]/.test(x)) {
    // 自动实时计算态：在已能算出结果的算式后按运算符续算，先固化为结果值，
    // 使公式呈现「18−10=8」而非「9×2−10=8」（二者数值同，但前者符合用户续算心智）
    var cv = calcValue(state.calc);
    if (cv != null && state.calc !== "") state.calc = String(cv);
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
    var nL = learnText(t);   // 剪贴板内容后台划词保存
    if (nL > 0) toast("此处成功保存划词 " + nL + " 个");
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
    if (learnMark[t]) item.classList.add("clip-learn");   // 新增词：黄橙背景
    if (state.clipDrop === t) { var dp = el("span", "clip-drop"); dp.textContent = "💧"; item.appendChild(dp); }
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
  TR("commit:" + [...t].length + "字");
  playClick();
  bridge(function (b) { b.commit(t); });
  if (!isApk()) { var ti = $("#testInput"); ti.value += t; }
  state.buf = "";
  state.cands = [];
  state.before += t;
  rememberRecent(t);
  renderCands(); renderLetterFaces();
  scheduleCtx(); scheduleSegment();
}
function rememberRecent(t) {
  if (!/[\u4e00-\u9fa5]/.test(t)) return;
  function put(x) { var ix = state.recent.indexOf(x); if (ix >= 0) state.recent.splice(ix, 1); state.recent.unshift(x); }
  if (t.length >= 2) put(t);    // 整词会话置顶（持久化统计统一走文本框划词 scheduleSegment）
  for (var i = t.length - 1; i >= 0; i--) put(t[i]);  // 单字也记录，逆序使首字靠前
  if (state.recent.length > 200) state.recent.length = 200;
  save("cw_recent", state.recent);
}
function userPhraseCode(t) {
  var ch = [...t], fc = function (i) { return UC[ch[i]] || ""; };
  if (ch.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (ch.length === 3) return fc(0)[0] + fc(1)[0] + fc(2).slice(0, 2);
  if (ch.length === 4) return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(3)[0];
  return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(ch.length - 1)[0];
}
/* 未登录中文片段：每个字都有端侧全码才按五笔词组规则合成编码（用户真实输入、非系统造词），否则不学习 */
function tryUserCode(t) {
  if (!t || t.length < 2 || t.length > 8) return null;
  var ch = [...t];
  for (var i = 0; i < ch.length; i++) if (!UC[ch[i]]) return null;
  return userPhraseCode(t);
}
/* ===== 本地高频词：以"文本框真实文本"划词统计（非候选栏）；用户自有设备、无过滤、不分发 ===== */
var SEG_W2C = null;
function segLexicon() {
  if (!SEG_W2C) {
    SEG_W2C = {};
    function addIdx(idx) { Object.keys(idx).forEach(function (code) { (idx[code] || []).forEach(function (o) {
      if (o.t && o.t.length >= 2 && !SEG_W2C[o.t]) SEG_W2C[o.t] = code;
    }); }); }
    addIdx(WUBI); addIdx(cloudIndex);
    Object.keys(LOCAL_FREQ).forEach(function (code) { LOCAL_FREQ[code].forEach(function (e) { if (!SEG_W2C[e.t]) SEG_W2C[e.t] = code; }); });
  }
  return SEG_W2C;
}
function canMakeAll(w) {
  var ch = [...w];
  for (var i = 0; i < ch.length; i++) if (!UC[ch[i]]) return false;
  return true;
}
/* 未登录碎片造词：短句(最长8)优先 → …→4→3→2；只造每字全码齐全的片段；未登录二字词同样学习（词库无法穷尽，靠使用补齐）*/
function makeUnknown(frag) {
  var res = [], i = frag.length;
  while (i > 0) {
    var hit = null;
    for (var L = Math.min(8, i); L >= 2; L--) { var w = frag.slice(i - L, i); if (canMakeAll(w)) { hit = w; break; } }
    if (hit) { res.push({ t: hit, c: userPhraseCode(hit) }); i -= hit.length; }
    else i--;
  }
  return res.reverse();
}
function segmentText(text, w2c) {
  var s = text.replace(/[A-Za-z0-9]+/g, " "), out = [];
  s.split(/[^一-龥]+/).filter(function (g) { return g.length >= 2; }).forEach(function (g) {
    var i = g.length, known = [];
    while (i > 0) {
      var hit = null;
      for (var L = Math.min(8, i); L >= 2; L--) { var w = g.slice(i - L, i); if (w2c[w]) { hit = w; break; } }
      if (hit) { known.push({ t: hit, c: w2c[hit], p: i - hit.length }); i -= hit.length; }
      else i--;
    }
    known.reverse();
    var pos = 0;
    function emitUnknown(a, b) { makeUnknown(g.slice(a, b)).forEach(function (o) { out.push(o); }); }
    known.forEach(function (k) {
      if (k.p > pos) emitUnknown(pos, k.p);
      out.push({ t: k.t, c: k.c }); pos = k.p + k.t.length;
    });
    if (pos < g.length) emitUnknown(pos, g.length);
  });
  return out;
}
function bumpLocal(t, code) {
  var today = Math.floor(Date.now() / 86400000);
  var arr = LOCAL_FREQ[code] || (LOCAL_FREQ[code] = []);
  if (SEG_W2C && !SEG_W2C[t]) SEG_W2C[t] = code;   // 增量同步划词缓存
  var e = arr.filter(function (x) { return x.t === t; })[0], isNew = 0;
  if (!e) { e = { t: t, c: 0, d: today, dd: today, dc: 0 }; arr.push(e); LOCAL_TODAY.n += 1; save("cw_local_today", LOCAL_TODAY); isNew = 1; }
  if (e.dd !== today) { e.dd = today; e.dc = 0; }   // 当天计数滚动（dc=最近一天上屏次数）
  e.dc = (e.dc || 0) + 1;
  e.c = (today - e.d >= WEEK_DAYS) ? 1 : e.c + 1; e.d = today;
  enforceLocalCap(); save("cw_local_freq", LOCAL_FREQ);
  if (isNew) {   // 新增词：标记黄橙，并直接列为剪贴板记录（去重、置顶）
    learnMark[t] = true; save("cw_learnmark", learnMark);
    state.clips = [t].concat((state.clips || []).filter(function (x) { return x !== t; })).slice(0, 50);
    saveClips();
  }
  return isNew;
}
function segmentAndLearn() {
  if (state.isPassword || state.numPassword) return;
  var before = getBefore(120), from = state.segLen || 0;
  state.segLen = before.length;
  if (before.length <= from) return;
  var add = before.slice(from);
  if (!/[一-龥]{2,}/.test(add)) return;
  var w2c = segLexicon(), newN = 0;
  segmentText(add, w2c).forEach(function (o) { if (o && o.t && o.c) newN += bumpLocal(o.t, o.c); });
  renderLocalStat();
  if (newN > 0) toast("已学习新词 " + newN + " 个 · 统计见「设置」");
}
var segTimer = null;
function scheduleSegment() { clearTimeout(segTimer); segTimer = setTimeout(segmentAndLearn, 1200); }
function localCount() { var n = 0; Object.keys(LOCAL_FREQ).forEach(function (c) { n += LOCAL_FREQ[c].length; }); return n; }
function localHotCount() { var n = 0; Object.keys(LOCAL_FREQ).forEach(function (c) { LOCAL_FREQ[c].forEach(function (e) { if (e.c >= FREQ_HOT) n++; }); }); return n; }
function enforceLocalCap() {
  var all = [];
  Object.keys(LOCAL_FREQ).forEach(function (c) { LOCAL_FREQ[c].forEach(function (e) { all.push([c, e]); }); });
  while (all.length > LOCAL_CAP) {
    all.sort(function (a, b) { return (a[1].c - b[1].c) || (a[1].d - b[1].d); });
    var rm = all.shift(), c = rm[0];
    LOCAL_FREQ[c] = LOCAL_FREQ[c].filter(function (x) { return x !== rm[1]; });
    if (!LOCAL_FREQ[c].length) delete LOCAL_FREQ[c];
  }
}
function renderLocalStat() {
  var elx = $("#localFreqStat");
  if (elx) elx.textContent = "本地高频词 " + localCount() + "/500 · 今日新增 " + LOCAL_TODAY.n + " · 高频(周≥50) " + localHotCount();
  var wh = $("#wubiHealth");
  if (wh) {
    var m = window.WUBI_META || { items: 0, codes: 0, failed: [] };
    wh.textContent = "端侧码表 " + m.items + " 条/" + m.codes + " 编码" + (m.failed && m.failed.length ? " · 加载失败分片:" + m.failed.join(",") : " · 加载正常");
  }
  renderLocalFreqList();
}
function renderLocalFreqList() {
  var box = $("#localFreqList");
  if (!box) return;
  box.innerHTML = "";
  var rows = [];
  Object.keys(LOCAL_FREQ).forEach(function (code) {
    LOCAL_FREQ[code].forEach(function (e) { rows.push({ code: code, e: e }); });
  });
  rows.sort(function (a, b) { return b.e.c - a.e.c; });
  if (!rows.length) { box.textContent = "暂无本地划词（在文本框输入整段话后会自动划词保存）"; box.className = "local-freq-list empty"; return; }
  box.className = "local-freq-list";
  rows.slice(0, 120).forEach(function (r) {
    var item = el("div", "lf-item");
    var tx = el("span", "lf-text"); tx.textContent = r.e.t;
    var cc = el("span", "lf-count"); cc.textContent = r.e.c + "次";
    var del = el("button", "lf-del"); del.setAttribute("type", "button"); del.textContent = "×";
    del.addEventListener("click", function () { removeLocalWord(r.code, r.e.t); });
    item.appendChild(tx); item.appendChild(cc); item.appendChild(del);
    box.appendChild(item);
  });
}
function removeLocalWord(code, text) {
  if (!LOCAL_FREQ[code]) return;
  LOCAL_FREQ[code] = LOCAL_FREQ[code].filter(function (x) { return x.t !== text; });
  if (!LOCAL_FREQ[code].length) delete LOCAL_FREQ[code];
  save("cw_local_freq", LOCAL_FREQ);
  renderLocalStat(); renderLocalFreqList();
  toast("已删除本地划词：" + text);
}
/* ---------- 改进计划：授权后匿名上传词频（默认关；端点未配置时仅本地排队） ---------- */
var TELE_ENDPOINT = "";   // 词频回流端点（部署腾讯云 SCF 后填入）
var teleQueue = load("cw_tele_queue", []);
function buildTelePayload() {
  var words = {};
  Object.keys(LOCAL_FREQ).forEach(function (code) {
    LOCAL_FREQ[code].forEach(function (e) {
      if (e.t && e.t.length >= 2) words[e.t] = (words[e.t] || 0) + (e.c || 1);
    });
  });
  return { v: "3.4", d: LOCAL_DAY, words: words };
}
function maybeTelemetry() {
  if (!settings.telemetry) return;
  var payload = buildTelePayload();
  if (!TELE_ENDPOINT) {
    teleQueue.push({ t: Date.now(), n: Object.keys(payload.words).length });
    save("cw_tele_queue", teleQueue.slice(-20)); renderTeleStat(); return;
  }
  try {
    fetch(TELE_ENDPOINT, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) })
      .then(function (r) { if (r.ok) { teleQueue.push({ t: Date.now(), ok: 1 }); save("cw_tele_queue", teleQueue.slice(-20)); renderTeleStat(); } })
      .catch(function () {});
  } catch (e) {}
}
function renderTeleStat() {
  var box = $("#teleStat");
  if (!box) return;
  var n = 0;
  try { n = Object.keys(buildTelePayload().words).length; } catch (e) {}
  box.textContent = settings.telemetry
    ? "已授权 · 可上报词 " + n + " 条" + (TELE_ENDPOINT ? " · 端点已配置" : " · 端点待部署（暂仅本地）")
    : "未开启 · 词频仅存本机";
}
/* 对一段文本（如剪贴板新记录）后台划词保存，返回保存词条数 */
function learnText(text) {
  if (!text || state.isPassword || state.numPassword) return 0;
  var w2c = segLexicon(), n = 0;
  segmentText(String(text), w2c).forEach(function (o) {
    if (o && o.t && o.c) { bumpLocal(o.t, o.c); n++; }
  });
  renderLocalStat();
  return n;
}
function delOnce() {
  TR("del");
  if (state.buf) { state.buf = state.buf.slice(0, -1); afterBufChange(); return; }
  playClick();
  bridge(function (b) { b.del(1); });
  if (!isApk()) { var ti = $("#testInput"); ti.value = ti.value.slice(0, -1); state.before = ti.value; }
  else if (state.before) state.before = state.before.slice(0, -1);
  if (state.panel === "number") calcDelTail();
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
/* 标点上屏前先消费编码：有候选首选上屏、无候选编码上屏（首选+标点先后上屏，不丢已打字）*/
function consumeBuf() {
  if (!state.buf) return false;
  if (state.cands && state.cands.length) {
    var f = state.cands[0]; pickCand(typeof f === "string" ? f : f.t);
  } else commitText(state.mode === "en" ? enCase(state.buf) : state.buf);
  return true;
}

function afterBufChange() {
  var cur = state.buf;
  function recompute() {
    if (state.buf !== cur) return;
    if (state.mode === "en") state.cands = enPrefixCands(cur);
    else if (state.mode === "py") state.cands = queryPinyin(cur);
    else if (state.mode === "smart") {
      var wp0 = mergeWP(queryWubi(cur), queryPinyin(cur));
      // 中文（五笔+拼音）无结果时用英文前缀兜底，实现中英混打不切换；英文不挤占中文候选
      state.cands = wp0.length ? wp0 : enPrefixCands(cur);
    }
    else state.cands = queryWubi(cur);
    renderCands();
  }
  recompute();
  if (!cur) return;
  if ((state.mode === "wubi" || state.mode === "smart") && cur.length === 4)
    ensureShard(cur.slice(0, 2)).then(recompute);
  if (state.mode === "smart" || state.mode === "py")
    schedulePyCloud(cur).then(recompute);
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
  var _t0 = performance.now();
  TR("press:" + c);
  playClick();
  if (state.shiftLock) { commitText(c.toUpperCase()); renderLetterFaces(); markKey(Math.round(performance.now() - _t0)); return; }  // 上档大写态：任意模式直接上大写英文
  if (state.mode === "en" || state.isPassword) {  // 密码框：字母逐字符上屏，不进五笔编码
    commitText(enLetterCase(c));
    refreshEnComplete();
    renderLetterFaces();
    markKey(Math.round(performance.now() - _t0));
    return;
  }
  state.buf += c;
  afterBufChange();
  markKey(Math.round(performance.now() - _t0));
}
function pressNumber(n) {
  playClick();
  // 数字面板：数字不自动上屏，只进算式自动算结果，用户选结果才上屏；数字密码逐位上屏
  if (state.panel === "number") { if (state.numPassword) commitText(n); else calcAppend(n); return; }
  if (state.isPassword) { commitText(n); return; }  // 文本密码框：数字直接上屏
  // 字母面板数字行：五笔编码中 1-9 快选候选
  if (state.buf && isZh() && /[1-9]/.test(n) && state.cands.length) {
    var i = parseInt(n, 10) - 1;
    if (state.cands[i]) { var o = state.cands[i]; pickCand(typeof o === "string" ? o : o.t); return; }
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
    if (state.cands && state.cands.length) { var f = state.cands[0]; pickCand(typeof f === "string" ? f : f.t); }
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

/* 上档键：任何状态按一下切到「英文大写输出」，再按恢复原模式（中文 / 英文小写） */
function cycleShift() {
  if (state.shiftLock) {
    state.shiftLock = false;
    state.mode = state.shiftPrevMode || state.mode;    // 恢复进入前的模式
    updateModeUI();
    toast("已恢复" + (state.mode === "en" ? "英文" : "中文") + "输入");
  } else {
    state.shiftPrevMode = state.mode;                 // 记住原模式
    state.shiftLock = true;
    state.buf = ""; state.cands = []; renderCands();
    toast("英文大写");
  }
  renderLetterFaces(); renderPunctToggles();
}

/* 模式切换（排它） */
function cycleMode() {
  state.mode = state.mode === "smart" ? "wubi" : state.mode === "wubi" ? "py" : state.mode === "py" ? "en" : "smart";
  if (!state.isPassword) state.userMode = state.mode;   // 记住用户主动选择的模式（密码框临时英文不覆盖）
  state.buf = ""; state.cands = []; state.ctxCands = [];
  state.shift = "upper";
  updateModeUI(); renderLetterFaces(); renderPunctToggles(); renderCands(); scheduleCtx();
  toast(state.mode === "smart" ? "混输（五笔+拼音）" : state.mode === "wubi" ? "纯五笔" : state.mode === "py" ? "纯拼音" : "英文");
}
function updateModeUI() {
  var b = $("#modeBtn");
  if (state.panel !== "letters") {
    b.textContent = "ABC"; b.classList.remove("en"); return;
  }
  b.textContent = state.mode === "smart" ? "混" : state.mode === "wubi" ? "中" : state.mode === "py" ? "拼" : "EN";
  b.classList.toggle("en", state.mode === "en");
}

/* 面板切换（单一排它，统一返回） */
function showPanel(n) {
  state.panel = n;
  TR("panel:" + n);
  $all("#panels > .panel").forEach(function (p) { p.classList.toggle("active", p.id === "p-" + n); });
  if (n === "clip") { pullClip(); renderClip(); }
  if (n === "settings") { refreshDiagView(); renderEngineList(); renderLocalStat(); renderTeleStat(); }
  if (n !== "letters" && n !== "number") { state.buf = ""; state.cands = []; renderCands(); }
  updateNumSymSwitch(n);
  updateToolbarActive(n);
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

/* 工具栏面板按钮：点一次进入，再点同一按钮返回字母主键盘 */
function togglePanel(target) {
  playClick();
  showPanel(state.panel === target ? "letters" : target);
}
/* 高亮当前所在面板对应的工具栏按钮（number/punct 由 numSymSwitch 处理）*/
function updateToolbarActive(n) {
  ["clip", "emoji", "phrase", "settings"].forEach(function (a) {
    var b = document.querySelector('#toolbar [data-act="' + a + '"]');
    if (b) b.classList.toggle("active", n === a);
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
    list = state.cands.map(function (x, i) {
      var o = (typeof x === "string") ? { t: x, src: "" } : x;
      var sc = o.src === "local" ? " src-local" : o.src === "cloud" ? " src-cloud"
        : (o.src === "py" || o.src === "py-pre") ? " src-py" : o.src === "sym" ? " src-sym" : "";
      return { t: o.t, src: o.src, fire: !!o.fire, n: i < 9 ? String(i + 1) : "", cls: (i === 0 ? "cand sel cand-anchor" : "cand") + sc };
    });
  } else {
    list = state.ctxCands || [];
  }
  list.forEach(function (c) {
    var b = el("button", c.cls || "cand"); b.setAttribute("type", "button");
    if (c.n) { var num = el("span", "num"); num.textContent = c.n; b.appendChild(num); }
    var tx = el("span", "cw"); tx.textContent = c.t; b.appendChild(tx);
    if (c.src === "cloud") { var ic = el("i", "src-ic"); ic.innerHTML = CLOUD_SVG; b.appendChild(ic); }
    if (c.src === "py" || c.src === "py-pre") { var pi = el("i", "src-ic py-ic"); pi.textContent = "拼"; b.appendChild(pi); }
    if (c.fire) { var fr = el("i", "fire-ic"); fr.textContent = "🔥"; b.appendChild(fr); }
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
  if (state.isPassword || state.numPassword) { state.ctxCands = []; state.enPre = ""; renderCands(); return; }
  var before = getBefore(100);
  state.before = before;
  if (state.buf) { renderCands(); return; }
  var zhTail = (before.match(/[一-龥]+$/) || [""])[0];
  if (!zhTail && state.before) zhTail = (state.before.match(/[一-龥]+$/) || [""])[0];
  var enTail = (before.match(/[a-zA-Z']+$/) || [""])[0];
  var cands = [];
  state.enPre = "";
  if (isZh() && zhTail) {
    var zhSugs = contextSug(before);
    if (!zhSugs.length && state.before) zhSugs = contextSug(state.before);  // 宿主读取滞后时本地兜底
    zhSugs.forEach(function (w) { cands.push({ t: w, cls: "cand", src: "ctx" }); });
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
        if (zh && /[一-龥]/.test(zh) && state.before.toLowerCase().endsWith(w0) && !state.buf) {
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

var SWIPE_DY = 17;        // 上滑垂直阈值(CSS px)：明确上滑才触发，避免正常击键的轻微上移被误判吞键
var SWIPE_RATIO = 1.5;    // 垂直占优比：斜向移动不算上滑
function longKind(el0) {
  if (el0.matches('[data-act="del"]')) return "del";
  if (el0.id === "space" || el0.getAttribute("data-act") === "space") return "space";
  if (el0.id === "lpunct" || el0.id === "rpunct") return "pswipe";
  if (el0.id === "shiftKey") return "ctx";
  if (el0.classList.contains("clip-item")) return "clip";
  if (el0.hasAttribute("data-long")) return "pop";
  return null;
}

document.addEventListener("pointerdown", function (e) {
  if (ptr) { clearTimeout(ptr.timer); if (ptr.iv) clearInterval(ptr.iv); if (ptr.el) ptr.el.classList.remove("press"); }  // 快速连点/指针被抢占：清理上一指针，避免旧长按误触发
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
  if (ptr.kind && ptr.kind !== "pswipe") {
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
    if (dy < -SWIPE_DY && Math.abs(dy) > Math.abs(dx) * SWIPE_RATIO) {
      ptr.swipePunct = true; ptr.long = true;
      ptr.el.classList.add("swipe-punct"); ptr.el.classList.remove("press");
      vib(12); L("字母上滑标点 dy=" + dy);
    }
  }
  // 主键盘数字行上滑 → 与点击一致（上屏数字）
  if (ptr.el.closest("#rowNum [data-num]") && !ptr.swipePunct && !ptr.long) {
    ptr.lastDx = dx; ptr.lastDy = dy;
    if (dy < -SWIPE_DY && Math.abs(dy) > Math.abs(dx) * SWIPE_RATIO) {
      ptr.swipePunct = true; ptr.numSwipe = true; ptr.long = true;
      ptr.el.classList.add("swipe-punct"); ptr.el.classList.remove("press");
      vib(12); L("数字行上滑 dy=" + dy);
    }
  }
  // 底排标点切换键：上滑在两个标点间切换（替代旧的长按 popup）
  var ptKey = ptr.el.closest("#lpunct,#rpunct");
  if (ptKey && !ptr.swipePunct && !ptr.long) {
    ptr.lastDx = dx; ptr.lastDy = dy;
    if (dy < -SWIPE_DY && Math.abs(dy) > Math.abs(dx) * SWIPE_RATIO) {
      ptr.swipePunct = true; ptr.long = true;
      ptKey.classList.add("swipe-punct"); ptKey.classList.remove("press");
      vib(12); L("标点键上滑切换 dy=" + dy);
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
      || (p.el.hasAttribute("data-letters") && p.lastDy < -SWIPE_DY && Math.abs(p.lastDy) > Math.abs(p.lastDx || 0) * SWIPE_RATIO)
      || (isNumUp && p.lastDy < -SWIPE_DY && Math.abs(p.lastDy) > Math.abs(p.lastDx || 0) * SWIPE_RATIO);
  if (wantSwipe) {
    p.el.classList.remove("swipe-punct");
    if (p.numSwipe || isNumUp) {
      pressNumber(p.el.getAttribute("data-num"));
    } else {
      var pc = p.el.getAttribute("data-letters"), pch = keyPunct(pc);
      if (pch) { consumeBuf(); commitText(pch); }
    }
    p.swipePunct = true; p.long = true;
  }
  // 标点键上滑 → 切换主/副标点（不上屏）；p.long 抑制随后 click，避免顺带标点
  var ptUp = p.el.closest("#lpunct,#rpunct");
  if (ptUp && (p.swipePunct || (p.lastDy < -SWIPE_DY && Math.abs(p.lastDy) > Math.abs(p.lastDx || 0) * SWIPE_RATIO))) {
    var which = ptUp.id === "lpunct" ? "l" : "r";
    consumeBuf(); commitText(punctPair(which)[1]);   // 首选先上屏，再上备用标点（！/？），不改默认
    ptUp.classList.remove("swipe-punct");
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
  if (pt) { var which = pt.id === "lpunct" ? "l" : "r"; consumeBuf(); commitText(punctPair(which)[0]); }
});

function onLong(p) {
  vib(14);
  if (p.kind === "del") {
    delOnce();
    p.iv = setInterval(function () { delOnce(); playClick(); }, 75);
  } else if (p.kind === "space") {
    startVoice();
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
    var span = k.querySelector(".cw");
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
    if (tx) {
      var w = tx.textContent, ci = state.clips.indexOf(w);
      if (ci > 0) { state.clips.splice(ci, 1); state.clips.unshift(w); }
      state.clipDrop = w; saveClips(); save("cw_clipdrop", w);   // 💧动态置顶标记
      renderClip();
      commitText(w); showPanel("letters");
    }
    return;
  }
  if (k.classList.contains("segback")) { showPanel("letters"); return; }
  if (k.classList.contains("seg-clear")) {
    state.clips = []; learnMark = {}; save("cw_learnmark", learnMark); saveClips(); renderClip(); toast("剪贴板已清空"); return;
  }
  if (k.classList.contains("toggle")) {
    var s = k.getAttribute("data-set");
    settings[s] = !settings[s]; save("cw_settings", settings);
    k.classList.toggle("on", settings[s]);
    applySettings();
    if (s === "trans") scheduleCtx();
    if (s === "telemetry") { if (settings.telemetry) toast("已加入改进计划，匿名上传"); renderTeleStat(); }
    return;
  }
  if (k.hasAttribute("data-dp")) {
    settings.dpScheme = k.getAttribute("data-dp"); save("cw_settings", settings);
    if (window.reloadDp) window.reloadDp(settings.dpScheme);
    $all("[data-dp]").forEach(function (b) { b.classList.toggle("sel", b.getAttribute("data-dp") === settings.dpScheme); });
    toast("双拼方案：" + k.textContent);
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
    case "number": togglePanel("number"); break;
    case "punct": togglePanel("punct"); break;
    case "goSymbol": showPanel("punct"); break;
    case "letters":
    case "backLetters": showPanel("letters"); break;
    case "commitAt": commitText("@"); break;
    case "emoji": togglePanel("emoji"); break;
    case "clip": togglePanel("clip"); break;
    case "phrase": togglePanel("phrase"); break;
    case "settings": togglePanel("settings"); break;
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
var voice = { active: false, cancel: false, heard: false, bars: [], tick: 0, tStart: null, tMax: null, tResult: null, tAuto: null };
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
  // 真实音量示波：以中线为基准、中间高两边低，整体高度直接由真实 RMS(0-100) 驱动
  var L0 = Math.max(0, Math.min(1, level / 100));
  var n = voice.bars.length, mid = (n - 1) / 2;
  for (var i = 0; i < n; i++) {
    var dist = Math.abs(i - mid) / mid;        // 0=中间 1=边缘
    var shape = 1 - dist * dist;               // 中间高、两侧低
    var jitter = 0.72 + Math.random() * 0.56;  // 轻微自然抖动
    var h = 6 + L0 * 46 * shape * jitter;
    voice.bars[i].style.height = Math.max(6, Math.min(52, h)) + "px";
  }
}
function clearVoiceTimers() {
  if (voice.tStart) { clearTimeout(voice.tStart); voice.tStart = null; }
  if (voice.tMax) { clearTimeout(voice.tMax); voice.tMax = null; }
  if (voice.tResult) { clearTimeout(voice.tResult); voice.tResult = null; }
  if (voice.tAuto) { clearTimeout(voice.tAuto); voice.tAuto = null; }
}
function armVoiceTimers() {
  clearVoiceTimers();
  voice.tStart = setTimeout(function () { if (voice.active && !voice.heard) voiceError("NOVOICE"); }, 6000);
}
function onVoiceHeard() {
  if (voice.heard) return;
  voice.heard = true;
  if (voice.tStart) { clearTimeout(voice.tStart); voice.tStart = null; }
  voice.tMax = setTimeout(function () {
    if (voice.active) { bridge(function (b) { b.stopVoice(); }); voiceError("TIMEOUT"); }
  }, 12000);
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
  voice.tResult = setTimeout(function () { closeVoice(); toast("未识别到语音，请重试"); }, 3000);
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
  // 2.6s 后自动关闭遮罩、恢复键盘（错误页不困住用户；也可点右上角 X 立即关闭）
  if (voice.tAuto) clearTimeout(voice.tAuto);
  voice.tAuto = setTimeout(function () {
    voice.active = false; setSpaceVoicing(false);
    $("#voiceOverlay").classList.remove("show");
  }, 2600);
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
  d.app = "云五笔·玻璃键盘 lite v3.8";
  d.mode = state.mode; d.panel = state.panel; d.shift = state.shift;
  d.wubi = window.WUBI_META || null;
  d.pinyin = window.PY_META || null;
  d.telemetry = { on: !!settings.telemetry, queued: teleQueue.length };
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
  // 文本密码框：强制英文模式、不自动大写（默认小写，可 Shift 切换）；普通框恢复用户模式、默认大写
  if (state.isPassword) state.mode = "en";
  else if (!state.numPassword) state.mode = "smart";   // 普通框默认混模式（五笔+拼音+英文都能出），用户无需分辨模式；手动临时切换不跨输入框
  state.shift = state.isPassword ? "lower" : "upper";
  state.shiftLock = false;   // 界面重新显示：复位上档大写态
  document.body.classList.toggle("pw-mode", !!state.isPassword);
  document.body.classList.toggle("numpw-mode", !!state.numPassword);
  // 数字密码 → 数字盘；其余 → 字母主面板，不残留子面板
  showPanel(state.numPassword ? "number" : "letters");
  renderCalc();
  renderCands(); renderLetterFaces();
  if (secret) { clearTimeout(ctxTimer); state.ctxCands = []; state.enPre = ""; renderCands(); }  // 密码框：取消待跑联想、不翻译、不读剪贴板
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
    if (s === "downloading") {
      $("#voStatus").textContent = "首次使用，正在下载离线语音模型（约228MB，建议WiFi）…";
      $("#voPartial").textContent = "下载完成后可永久离线识别普通话 / 粤语 / 英语";
    }
    else if (s === "ready") $("#voStatus").textContent = "请说话…";
    else if (s === "listening") { $("#voStatus").textContent = "正在聆听…"; onVoiceHeard(); }
    else if (s === "processing") $("#voStatus").textContent = "识别中…";
  },
  voiceProgress: function (p) {
    p = Math.max(0, Math.min(100, p));
    $("#voStatus").textContent = "正在下载离线语音模型 " + p + "%（建议保持WiFi）…";
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

function closeVoice() {
  clearVoiceTimers();
  voice.active = false;
  setSpaceVoicing(false);
  $("#voiceOverlay").classList.remove("show");
}

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
  $("#clearUserWords").addEventListener("click", function () {
    for (var k in LOCAL_FREQ) delete LOCAL_FREQ[k];
    localStorage.removeItem("cw_local_freq");
    LOCAL_TODAY = { d: Math.floor(Date.now() / 86400000), n: 0 }; save("cw_local_today", LOCAL_TODAY);
    state.segLen = 0; renderLocalStat(); toast("本地高频词已清空");
  });
  $("#clearRecent").addEventListener("click", function () {
    state.recent = []; localStorage.removeItem("cw_recent"); toast("最近用字已清空");
  });
  $("#diagCopy").addEventListener("click", function () {
    var txt = collectDiag();
    bridge(function (b) { b.copy(txt); });
    if (!isApk()) { try { navigator.clipboard.writeText(txt); } catch (e) {} }
    toast("诊断信息已复制，可粘贴发给开发者");
  });
  $("#diagShare").addEventListener("click", function () {
    var txt = collectDiag();
    bridge(function (b) { b.share("【云五笔·玻璃键盘 v3.8 问题反馈】\n" + txt); });
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
  L("app init v3.0, bridge=" + isApk());
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
  renderLocalStat();
  updateModeUI();
  applySettings();
  renderCands();
  bindStatic();
  applyLayout();
  setTimeout(applyLayout, 350);   // 大词库解析后窗口稳定，补报高度（治首次 insets=0）
  setTimeout(applyLayout, 1000);
  $("#verLabel").textContent = "云五笔·玻璃键盘 lite v3.8 · 端侧含全码单字+二/三字高频词+高频四字；长尾词云端按需、核心离线可用；首次语音按需下载离线模型（约228MB）";
  if (!isApk()) {
    document.body.classList.add("preview");
    toast("浏览器预览：点击输入框获得焦点后试用");
  }
  L("初始化完成");
}
if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
else init();

})();
