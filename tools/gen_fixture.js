// 生成回归夹具 fixture.json —— 二/三/四级首选字、四码词组（仅规范简体）
// 运行：在仓库根执行 `node tools/gen_fixture.js`（需先 npm install opencc-js）
const fs = require("fs");
const path = require("path");
const OpenCC = require("opencc-js");
const t2s = OpenCC.Converter({ from: "tw", to: "cn" });
const DIR = __dirname;
const GSC = new Set(fs.readFileSync(path.join(DIR, "gsc_8105.txt"), "utf8"));
const lines = fs.readFileSync(path.join(DIR, "wubi86_jidian.dict.yaml"), "utf8").split("\n");
const start = lines.indexOf("...");
const first = { 2: new Map(), 3: new Map(), 4: new Map() };
const phrases = [];
for (let i = start + 1; i < lines.length; i++) {
  const p = lines[i].split("\t"); if (p.length < 2) continue;
  const text = p[0].trim(), code = p[1].trim();
  if (!/^[a-y]{1,4}$/.test(code)) continue;
  if (t2s(text) !== text) continue;
  if (![...text].every(ch => GSC.has(ch))) continue;
  const L = code.length;
  if (L >= 2 && L <= 4 && !first[L].has(code)) first[L].set(code, text);
  if (L === 4 && [...text].length >= 2) phrases.push({ code, text });
}
const L2 = [...first[2]].map(([code, text]) => ({ code, text }));
const L3 = [...first[3]].map(([code, text]) => ({ code, text }));
const L4 = [...first[4]].map(([code, text]) => ({ code, text })).filter(x => [...x.text].length === 1);
fs.writeFileSync(path.join(DIR, "fixture.json"), JSON.stringify({ L2, L3, L4, phrases }));
console.log("二级简码", L2.length, " 三级简码", L3.length, " 四级全码单字", L4.length, " 四码词组", phrases.length);
