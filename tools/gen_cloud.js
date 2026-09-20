// 生成云端分片词库：完整词库按"编码前2码"分片，输出 cloud/<前缀>.json，App 按需 fetch、缓存。
const fs = require("fs");
const win = {}; global.window = win;
eval(fs.readFileSync("CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js", "utf8"));
const WUBI = win.WUBI_INDEX;

const OUT = "cloud";
if (!fs.existsSync(OUT)) fs.mkdirSync(OUT);
const shards = {};
Object.keys(WUBI).forEach(code => {
  const key = code.slice(0, 2);
  (shards[key] = shards[key] || {});
  shards[key][code] = WUBI[code].map(o => [o.t, o.f]);
});
let files = 0, total = 0;
Object.keys(shards).sort().forEach(key => {
  const json = JSON.stringify(shards[key]);
  fs.writeFileSync(OUT + "/" + key + ".json", json);
  files++; total += json.length;
});
console.log("分片文件:", files, " 云端总大小:", (total / 1024).toFixed(0) + "KB");
console.log("示例分片 wn:", (fs.statSync(OUT + "/wn.json").size / 1024).toFixed(1) + "KB");
