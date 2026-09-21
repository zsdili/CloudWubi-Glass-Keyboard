// 端侧码表分片：简码全留 + 全码 top1500 单字 + 全部两/三字词；按首码 a-y 切成 25 个 JSON 分片。
// app 启动用同步 XHR 加载、JSON.parse（运行时构建，规避旧 WebView 单字面量常量池上限），本地即时、离线可用。
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

// 每个字的标准全码（取频次最高的 4 码），覆盖 dict.yaml 全部单字（约 8105+）
const best4 = {};
groups.forEach((m, code) => { if (code.length === 4) m.forEach((f, t) => {
  if (!best4[t] || f > best4[t].f) best4[t] = { code, f };
}); });
// 每个字的标准编码（不限长度：优先4码全码，无则3/2码，如"多"qqu），用于合成补丁词组
const bestCode = {};
groups.forEach((m, code) => m.forEach((f, t) => {
  const cur = bestCode[t];
  if (!cur || f > cur.f || (f === cur.f && code.length > cur.code.length)) bestCode[t] = { code, f };
}));

const idx = {};
function addIdx(code, t, f) {
  const a = (idx[code] = idx[code] || []);
  const ex = a.find(x => x.t === t);
  if (ex) { if (f > ex.f) ex.f = f; } else a.push({ t: t, f: f });
}
// 单字：简码全留 + 全部全码单字（保证任意词组可按 86 规则合成）
groups.forEach((m, code) => { if (code.length < 4) m.forEach((f, t) => addIdx(code, t, 100)); });
Object.keys(best4).forEach(t => addIdx(best4[t].code, t, 100));

// ---- 二字词候选池（full v31 + 极点 + 补丁，按频次去重），最终只取高频 TOP，长尾走云端 ----
const c2 = {};
function add2(code, t, f) {
  if (!c2[code]) c2[code] = new Map();
  const ex = c2[code].get(t);
  if (ex === undefined || f > ex) c2[code].set(t, f);
}
const fsb = { window: {} }; vm.createContext(fsb);
vm.runInContext(fs.readFileSync("data_wubi.full.v31.js", "utf8"), fsb);
fsb.window.WUBI_RAW.forEach(line => {
  const p = line.split(" "); if (p.length < 3) return;
  const code = p[0], w = p.slice(1, -1).join(" "), f = parseInt(p[p.length - 1], 10) || 0;
  if ([...w].length === 2 && /^[a-y]{4}$/.test(code)) add2(code, w, f);
});

// 高频常用二字词补丁（源词库偶缺，如"更多"gjqq）：按各字全码前两码合成编码，加入候选池
const PATCH2 = ("更多 所有 没有 可以 应该 可能 知道 觉得 怎么 怎样 什么 这个 那个 这些 那些 我们 你们 他们 她们 它们 自己 别人 大家 朋友 问题 事情 东西 地方 时候 时间 现在 今天 明天 昨天 今年 明年 去年 开始 结束 继续 停止 需要 希望 喜欢 高兴 难过 开心 快乐 幸福 健康 工作 学习 生活 家庭 社会 国家 世界 公司 企业 产品 市场 经济 发展 建设 服务 管理 技术 科技 信息 网络 手机 电脑 系统 软件 应用 数据 内容 文章 报告 新闻 视频 图片 音乐 电影 游戏 运动 旅游 餐厅 酒店 交通 天气 环境 教育 学校 学生 老师 医生 医院 银行 商店 超市 价格 费用 质量 品牌 口碑 体验 功能 设计 界面 布局 风格 颜色 字体 图标 按钮 键盘 输入 输出 语音 文字 语言 中文 英文 拼音 五笔 词组 词语 词库 单词 句子 标点 符号 数字 计算 结果 公式 翻译 联想 粘贴 删除 撤销 保存 设置 选项 确认 取消 返回 搜索 分享 点赞 评论 收藏 关注 直播 快递 物流 支付 密码 账号 安全 隐私 始终 说明 不要 人民 吃饭 睡觉 上班 广东 你好 谢谢 北京 上海 广州 深圳 中山 喉咙 感冒 下雨 带伞 晚安 请问 麻烦 辛苦 欢迎 再见 稍等 立刻 马上 经常 偶尔 永远 一直 已经 正在 即将 必须 一定 确实 其实 当然 然后 因为 所以 但是 而且 或者 如果 虽然 不仅 不管 尽管 为了 关于 对于 根据 通过 进行 得到 使用 提供 支持 保证 发现 出现 存在 产生 形成 成为 认为 表示 决定 选择 准备 计划 完成 实现 解决 处理 改善 提升 提高 增加 减少 保持 符合 达到 确保 避免 防止 建议 考虑 应该 比较 非常 特别 十分 更加 较为 最 很 都 也 还 又 再 才 就 只 仅").split(" ");
PATCH2.forEach(w => {
  const ch = [...w];
  if (ch.length !== 2) return;
  const a = bestCode[ch[0]], b = bestCode[ch[1]];
  if (a && b) add2(a.code.slice(0, 2) + b.code.slice(0, 2), w, 60000);
});

// 极点权威词库：仅合入简体二字词（真实词频）入候选池；三字以上走云端
["wubi86_jidian.dict.yaml", "wubi86_jidian_extra.dict.yaml", "wubi86_jidian_extra_district.dict.yaml"].forEach(fn => {
  const lines = fs.readFileSync(fn, "utf8").split("\n");
  const st = lines.indexOf("...");
  for (let i = (st < 0 ? 0 : st + 1); i < lines.length; i++) {
    const p = lines[i].split("\t");
    if (p.length < 2) continue;
    const w = p[0].trim(), code = p[1] ? p[1].trim() : "";
    const fj = p[2] ? (parseFloat(p[2]) || 0) : 0;
    if ([...w].length === 2 && /^[a-y]{4}$/.test(code) && /^[\u4e00-\u9fff]+$/.test(w)) {
      add2(code, w, 3000 + fj * 30);
    }
  }
});

// 二字词按频次取 TOP（其余长尾全部由云端 cloud 提供）
const TOP2 = 12000;
const all2 = [];
Object.keys(c2).forEach(code => c2[code].forEach((f, t) => all2.push({ code, t, f })));
all2.sort((x, y) => y.f - x.f);
let n2 = 0;
all2.slice(0, TOP2).forEach(o => { addIdx(o.code, o.t, o.f); n2++; });
console.log("二字词候选池:", all2.length, " 端侧取高频:", n2);

const dir = "CloudWubiKeyboard/app/src/main/assets/web/lite/";
if (fs.existsSync(dir)) fs.readdirSync(dir).forEach(f => fs.unlinkSync(dir + f)); else fs.mkdirSync(dir, { recursive: true });
const letters = "abcdefghijklmnopqrstuvwxy";
let total = 0; const sizeInfo = [];
letters.split("").forEach(L => {
  const part = {};
  Object.keys(idx).filter(c => c[0] === L).sort().forEach(c => part[c] = idx[c]);
  const n = Object.values(part).reduce((s, a) => s + a.length, 0);
  fs.writeFileSync(dir + L + ".json", JSON.stringify(part));
  const sz = fs.statSync(dir + L + ".json").size;
  sizeInfo.push(L + ":" + n + "条/" + (sz / 1024).toFixed(0) + "KB");
  total += n;
});
// 移除旧的单大文件
const oldF = "CloudWubiKeyboard/app/src/main/assets/web/data_wubi.js";
if (fs.existsSync(oldF)) fs.unlinkSync(oldF);
console.log("端侧高频二字词:", n2, " 端侧总条目:", total);
console.log(sizeInfo.join("  "));
