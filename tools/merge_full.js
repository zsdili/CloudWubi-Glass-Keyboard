const fs = require("fs"), vm = require("vm");
const s = { window: {} }; vm.createContext(s);
vm.runInContext(fs.readFileSync("data_wubi.full.v30.js", "utf8"), s);
const pop = fs.readFileSync("popular_extra.raw", "utf8").split("\n").filter(x => x.trim());
const map = new Map();
s.window.WUBI_RAW.forEach(function (l) {
  const p = l.split(" "), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(" ");
  map.set(code + "\u0000" + t, { code: code, t: t, f: f });
});
pop.forEach(function (l) {
  const p = l.split(" "), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(" ");
  const k = code + "\u0000" + t, ex = map.get(k);
  if (!ex || f > ex.f) map.set(k, { code: code, t: t, f: f });
});
const all = [...map.values()].sort((a, b) => a.code < b.code ? -1 : a.code > b.code ? 1 : 0);
const raw = all.map(o => o.code + " " + o.t + " " + o.f);
const header = "// 五笔86完整词库 v31（v30 + 流行语/长词增补）：单字/简码=86原方案；词组含 jieba/成语/歇后语/口语/流行语。\n";
const out = header + "window.WUBI_RAW = [\n" + raw.map(x => '"' + x + '"').join(",\n") + "\n];\n" +
"window.WUBI_INDEX = (function () {\n  var idx = {};\n  window.WUBI_RAW.forEach(function (line) {\n    var p = line.split(' '), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(' ');\n    (idx[code] = idx[code] || []).push({ t: t, f: f });\n  });\n  return idx;\n})();\n";
fs.writeFileSync("data_wubi.full.v31.js", out);
console.log("v31 条目:", raw.length, " 大小:", (fs.statSync("data_wubi.full.v31.js").size / 1024).toFixed(0) + "KB");
