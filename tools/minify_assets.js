// 从 web-src（可读源）压缩生成 assets/web（仅压缩产物进 APK）
const fs = require("fs");
const Terser = require("terser");
const CleanCSS = require("clean-css");
const SRC = "web-src", W = "CloudWubiKeyboard/app/src/main/assets/web";

(async () => {
  // JS
  for (const [s, out] of [["app.js", "app.min.js"], ["data_en.js", "data_en.min.js"], ["context_scenes.js", "context_scenes.min.js"]]) {
    const r = await Terser.minify(fs.readFileSync(SRC + "/" + s, "utf8"),
      { compress: { passes: 2 }, mangle: true, format: { comments: false } });
    if (r.error) throw r.error;
    fs.writeFileSync(W + "/" + out, r.code);
  }
  // CSS
  const css = new CleanCSS({ level: 2, compatibility: "*" }).minify(fs.readFileSync(SRC + "/style.css", "utf8"));
  fs.writeFileSync(W + "/style.min.css", css.styles);
  // index.html 引用改为 .min
  let html = fs.readFileSync(SRC + "/index.html", "utf8");
  html = html.replace('href="style.css"', 'href="style.min.css"')
             .replace('src="data_en.js"', 'src="data_en.min.js"')
             .replace('src="context_scenes.js"', 'src="context_scenes.min.js"')
             .replace('src="app.js"', 'src="app.min.js"');
  fs.writeFileSync(W + "/index.html", html);
  // 删除 assets 里的可读版（避免进 APK）
  ["app.js", "data_en.js", "context_scenes.js", "style.css"].forEach(f => { try { fs.unlinkSync(W + f); } catch (e) {} });
  console.log("app.min:", (fs.statSync(W + "/app.min.js").size / 1024).toFixed(1) + "KB",
    " data_en.min:", (fs.statSync(W + "/data_en.min.js").size / 1024).toFixed(1) + "KB",
    " style.min:", (fs.statSync(W + "/style.min.css").size / 1024).toFixed(1) + "KB");
})();
