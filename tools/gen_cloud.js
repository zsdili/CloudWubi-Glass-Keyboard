// 云端分片 = 完整词库减去端侧（端侧已含简码/top单字/全部两·三字词），故只放四字以上长词与被砍单字，分片更小、拉取更快。
const fs = require("fs"), vm = require("vm");
function load(file) {
  const s = { window: {} }; vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, "utf8"), s);
  return s.window.WUBI_INDEX;
}
const FULL = load("data_wubi.full.v30.js");
const LITE = load("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js");
const OUT = "cloud";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
const shards = {};
Object.keys(FULL).forEach(code => {
  const have = new Set((LITE[code] || []).map(o => o.t));
  (FULL[code] || []).forEach(o => {
    if (have.has(o.t)) return;
    const key = code.slice(0, 2);
    shards[key] = shards[key] || {};
    (shards[key][code] = shards[key][code] || []).push([o.t, o.f]);
  });
});
let files = 0, total = 0;
Object.keys(shards).sort().forEach(key => {
  const json = JSON.stringify(shards[key]);
  fs.writeFileSync(OUT + "/" + key + ".json", json); files++; total += json.length;
});
console.log("分片文件:", files, " 云端总大小:", (total / 1024).toFixed(0) + "KB");
