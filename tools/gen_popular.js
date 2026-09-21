const fs = require("fs");
const GSC = new Set(fs.readFileSync("gsc_8105.txt", "utf8"));
const fullCode = {};
function parse(file) {
  fs.readFileSync(file, "utf8").split("\n").forEach(function (l) {
    const p = l.split("\t"); if (p.length < 2) return;
    const text = p[0].trim(), code = p[1].trim();
    if (!text || !code || !/^[a-y]{1,4}$/.test(code)) return;
    if ([...text].length !== 1 || !GSC.has(text)) return;
    if (!fullCode[text] || code.length > fullCode[text].length) fullCode[text] = code;
  });
}
parse("wubi86_official.dict.yaml"); parse("wubi86_jidian.dict.yaml");
function phraseCode(phrase) {
  const ch = [...phrase], fc = i => fullCode[ch[i]] || "";
  if (ch.length === 2) return fc(0).slice(0, 2) + fc(1).slice(0, 2);
  if (ch.length === 3) return fc(0)[0] + fc(1)[0] + fc(2).slice(0, 2);
  if (ch.length === 4) return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(3)[0];
  return fc(0)[0] + fc(1)[0] + fc(2)[0] + fc(ch.length - 1)[0];
}
const byLen = {}, failed = [], seen = new Set(), rows = [];
fs.readFileSync("popular_extra.txt", "utf8").split("\n").forEach(function (l) {
  const text = l.trim(); if (!text || seen.has(text)) return; seen.add(text);
  const ch = [...text];
  const miss = ch.filter(c => !fullCode[c]);
  if (miss.length) { failed.push(text + "(缺:" + [...new Set(miss)].join("") + ")"); return; }
  const code = phraseCode(text);
  if (!/^[a-y]{4}$/.test(code)) { failed.push(text + "(code " + code + ")"); return; }
  byLen[ch.length] = (byLen[ch.length] || 0) + 1;
  rows.push(code + " " + text + " " + (ch.length === 2 ? 2000 : 600));
});
fs.writeFileSync("popular_extra.raw", rows.join("\n") + "\n");
console.log("成功按字数:", JSON.stringify(byLen));
console.log("总成功:", rows.length);
console.log("失败:", failed.length);
failed.forEach(f => console.log("  ", f));
