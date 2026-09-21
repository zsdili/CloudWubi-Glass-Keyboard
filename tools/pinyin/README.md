# 拼音数据生成（全拼 / 双拼 / 简拼）

云五笔的拼音引擎由本目录脚本生成，与五笔共用同一套字词来源。

## 脚本

| 文件 | 作用 |
|---|---|
| `gen_pinyin.js` | 读取五笔 lite/cloud 全部字词，生成音节表、全拼、简拼源数据（`pygen_syl/full/jian.json`） |
| `gen_py_shards.js` | 按词频切端侧（高频 + 日常口语词 + 符号）与云端（长尾），输出 `py/` 与 `cloud_py/` |
| `gen_dp.js` | 生成双拼方案键位（微软/自然码/小鹤/拼音加加等） |

## 依赖与数据来源（开源、免费）

```bash
npm init -y
npm install pinyin-pro @pinyin-pro/data/complete ws
# 开源读音/词组/双拼数据：
git clone https://github.com/mozillazg/pinyin-data
git clone https://github.com/mozillazg/phrase-pinyin-data
git clone https://github.com/rime/rime-double-pinyin
```

- 读音规范：`pinyin-data/kMandarin.txt`
- 多音字/词频：`pinyin-pro` 的 complete 数据
- 双拼键位：`rime-double-pinyin`

## 复现顺序

```bash
# 1. 先生成五笔 lite（见 ../gen_lite.js）与云端 cloud（../gen_cloud.js）
# 2. 再生成拼音源数据与分片：
node gen_pinyin.js
node gen_py_shards.js
node gen_dp.js
# 3. cloud_py/ 提交到仓库（App 经 jsDelivr 拉取）；py/ 为端侧构建产物，随 APK 打包
```

## 设计要点

- **端侧**：音节表（单字读音）+ 高频全拼/简拼词 + 日常口语白名单（第三方词频对"你好"等口语赋值偏低，用白名单兜底）+ 拼音符号（打 jia 出 ＋）。
- **云端**：长尾拼音词，按首字母分片，懒加载。
- **容错**：漏字母/方言（如 bejng→北京）在端侧按编辑距离纠错。
