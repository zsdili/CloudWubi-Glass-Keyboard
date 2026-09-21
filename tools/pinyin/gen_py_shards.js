const fs = require('fs');
const syl = require('./pygen_syl.json');
const full = require('./pygen_full.json');
const jian = require('./pygen_jian.json');

const FULL_TOP = 4000, JIAN_TOP = 1500;
// 日常交流极常用词：第三方词频对口语词赋值偏低（如"你好"f=7 会被 TOP 误删），强制端侧；数量可控、不发胖
const DAILY = new Set(("你好 您好 你们 你是 你的 你呢 你早 你们好 早上好 晚上好 中午好 下午好 早安 晚安 谢谢 感谢 多谢 辛苦了 辛苦 麻烦你 对不起 抱歉 没关系 不好意思 再见 拜拜 回头见 一会儿见 吃饭 吃了吗 吃饭了吗 吃了没 喝水 喝茶 睡觉 睡着了 起床 上班 下班 到家 回家 出去 进来 来了 知道了 明白了 好的 好吧 是不是 好不好 行不行 有没有 对不对 怎么办 为什么 怎么样 在哪里 去哪儿 去哪了 干什么 做什么 多少 几个 这里 那里 这个 那个 什么 怎么 我们 咱们 他们 她们 大家 自己 别人 朋友 同学 老师 医生 爸爸 妈妈 哥哥 姐姐 弟弟 妹妹 儿子 女儿 孩子 宝宝 小朋友 喜欢 开心 高兴 快乐 难过 舒服 难受 疼 痛 感冒 发烧 咳嗽 喉咙 医院 看病 没事 注意 小心 一路顺风 注意安全 生日快乐 新年快乐 恭喜发财 身体健康 万事如意 请问 请讲 请说 在吗 在不在 听得到吗 喂 你是谁 你在哪 我想你 我爱你 喜欢你 好想你 真的吗 真的 假的 是的 对的 没错 可以 不行 不要 不用 等一下 稍等 立刻 马上 现在 今天 明天 昨天 今年 明年 去年 北京 上海 广州 深圳 广东 中山 天气 下雨 出太阳 冷 热 暖和 凉快").split(" "));

// 展平并按词频排序（sym / 日常词 强制端侧）
function flatten(map) {
  const a = [];
  for (const k in map) for (const o of map[k]) a.push({ k, t: o.t, f: o.sym ? 1e9 : (o.f || 0), sym: o.sym ? 1 : 0, daily: DAILY.has(o.t) ? 1 : 0 });
  a.sort((x, y) => y.f - x.f);
  return a;
}
function splitShard(flat, top) {
  const local = {}, cloud = {};
  flat.forEach((o, i) => {
    const into = (i < top || o.sym || o.daily) ? local : cloud;
    (into[o.k] = into[o.k] || []).push(o.sym ? { t: o.t, f: 0, sym: 1 } : { t: o.t, f: o.f });
  });
  return { local, cloud };
}
// 云端按串首字母分片
function byLetter(cloud, outDir, name) {
  const buckets = {};
  for (const k in cloud) {
    const L = k[0];
    (buckets[L] = buckets[L] || {})[k] = cloud[k];
  }
  for (const L in buckets) {
    const p = outDir + '/' + L + '.json';
    fs.writeFileSync(p, JSON.stringify(buckets[L]));
  }
  return Object.keys(buckets).length;
}

const fFlat = flatten(full), jFlat = flatten(jian);
const F = splitShard(fFlat, FULL_TOP), J = splitShard(jFlat, JIAN_TOP);

const outLocal = '../CloudWubiKeyboard/app/src/main/assets/web/py';
fs.mkdirSync(outLocal, { recursive: true });
fs.mkdirSync('../cloud_py/full', { recursive: true });
fs.mkdirSync('../cloud_py/jian', { recursive: true });
fs.writeFileSync(outLocal + '/syl.json', JSON.stringify(syl));
fs.writeFileSync(outLocal + '/full.json', JSON.stringify(F.local));
fs.writeFileSync(outLocal + '/jian.json', JSON.stringify(J.local));
const fc = byLetter(F.cloud, '../cloud_py/full'), jc = byLetter(J.cloud, '../cloud_py/jian');

const sz = o => (Buffer.byteLength(JSON.stringify(o)) / 1024).toFixed(0) + 'KB';
console.log(JSON.stringify({
  local: { syl: sz(syl), full: sz(F.local), jian: sz(J.local) },
  cloud: { fullShards: fc, jianShards: jc }
}, null, 1));
