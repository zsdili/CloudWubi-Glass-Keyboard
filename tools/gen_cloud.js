// 云端分片 = 完整词库 v31 减去端侧 lite；只放端侧没有的（长词/被砍单字），按编码前两字符切片。
const fs = require("fs"), vm = require("vm");
function loadIndex(file) {
  const s = { window: {} }; vm.createContext(s);
  vm.runInContext(fs.readFileSync(file, "utf8"), s);
  return s.window.WUBI_INDEX;
}
const FULL = loadIndex("data_wubi.full.v31.js");
const LITE = {};
const liteDir = "CloudWubiKeyboard/app/src/main/assets/web/lite/";
fs.readdirSync(liteDir).forEach(f => Object.assign(LITE, JSON.parse(fs.readFileSync(liteDir + f))));
const OUT = "cloud";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
fs.readdirSync(OUT).forEach(f => fs.unlinkSync(OUT + "/" + f));
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
