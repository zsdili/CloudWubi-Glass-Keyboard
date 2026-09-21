// 端侧码表：一/二/三级简码全留 + 全码 top1500 单字 + 全部两字/三字词（本地即时、零等待）；四字以上长词与其余单字云端按需。
const fs = require("fs"), vm = require("vm");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));
const groups = new Map();
function parse(file) {
  const lines = fs.readFileSync(file, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t"); if (p.length < 2) continue;
    const text = p[0].trim(), code = p[1].trim(), f = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if (!text || !/^[a-y]{1,4}$/.test(code) || [...text].length !== 1 || !GSC.has(text)) continue;
    if (!groups.has(code)) groups.set(code, new Map());
    const m = groups.get(code);
    if (!m.has(text) || f > m.get(text)) m.set(text, f);
  }
}
parse("wubi86_official.dict.yaml"); parse("wubi86_jidian.dict.yaml");

const FULL_TOP = 1500;
const best4 = {};
groups.forEach((m, code) => { if (code.length === 4) m.forEach((f, t) => {
  if (!best4[t] || f > best4[t].f) best4[t] = { code, f };
}); });
const topChars = Object.keys(best4).sort((a, b) => best4[b].f - best4[a].f).slice(0, FULL_TOP);
const topSet = new Set(topChars);

// 单字：简码全留 + 全码 top1500
let nShort = 0, nFull = 0; const lines = [];
[...groups.keys()].sort().forEach(code => groups.get(code).forEach((f, t) => {
  if (code.length < 4) { lines.push(code + " " + t); nShort++; }
  else if (topSet.has(t) && best4[t].code === code) { lines.push(code + " " + t); nFull++; }
}));

// 全部两字/三字词（来自多源融合完整词库，带真实频次用于排序）
const fsb = { window: {} }; vm.createContext(fsb);
vm.runInContext(fs.readFileSync("data_wubi.full.v30.js", "utf8"), fsb);
const multiLines = []; const seenM = new Set(); let n23 = 0;
fsb.window.WUBI_RAW.forEach(line => {
  const p = line.split(" "); if (p.length < 3) return;
  const code = p[0], w = p.slice(1, -1).join(" "), f = p[p.length - 1];
  const L = [...w].length;
  if ((L === 2 || L === 3) && /^[a-y]{2,4}$/.test(code)) {
    const k = code + " " + w;
    if (!seenM.has(k)) { seenM.add(k); multiLines.push(k + " " + f); n23++; }
  }
});

const raw = lines.map(l => l + " 100").concat(multiLines);
const header = "// 端侧：简码全留+全码top" + FULL_TOP + "单字+全部两/三字词（本地即时）；四字以上长词云端按需，离线降级。\nwindow.WUBI_RAW = [\n";
const builder = "\n];\nwindow.WUBI_INDEX = (function () {\n  var idx = {};\n" +
"  window.WUBI_RAW.forEach(function (line) {\n" +
"    var p = line.split(' '), code = p[0], f = parseInt(p[p.length - 1], 10), t = p.slice(1, -1).join(' ');\n" +
"    (idx[code] = idx[code] || []).push({ t: t, f: f }); });\n  return idx;\n})();\n";
fs.writeFileSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js",
  header + raw.map(x => '"' + x + '"').join(",\n") + builder);
console.log("简码行:", nShort, " 全码单字:", nFull, " 两/三词:", n23, " 总:", raw.length,
  " 大小:", (fs.statSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js").size / 1024).toFixed(0) + "KB");
