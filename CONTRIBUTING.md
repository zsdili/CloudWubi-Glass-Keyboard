# 贡献指南 CONTRIBUTING

感谢你对「云五笔 · 玻璃键盘」的关注！欢迎通过 Issue、Pull Request、词库补充、文档完善等方式参与贡献。

## 你可以贡献什么

- 🐛  Bug 反馈与修复（请附上机型、Android 版本、复现步骤，最好有日志或截图）。
- 📝  词库补充：缺失的常用字、词组、长词。
- ✨ 新功能与体验优化、性能改进。
- 📚  文档、翻译、无障碍支持。

## 开发环境

- **JDK 11**
- **Android SDK**：Platform android-33、Build-Tools 33.0.2、Platform-Tools
- 用于词库生成 / Headless 测试时：**Node.js 16+**

## 构建

```bash
./gradlew assembleDebug
# 产物：app/build/outputs/apk/debug/app-debug.apk
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

## 词库可复现

词库由开源五笔字典经脚本生成，工具位于 `tools/`：

```bash
npm install opencc-js
node tools/gen_wubi_data.js   # 生成前端数据
node tools/gen_fixture.js     # 生成回归夹具
```

- 长词遵循「整取不切碎、能长尽量长」。
- 单字与词组均以《通用规范汉字表》8105 字为白名单，确保仅含规范简体。

## 提交规范

1. Fork 本仓库并从 `main` 切出描述性分支，如 `fix/voice-timeout`、`feat/cloud-words`。
2. 一次提交聚焦一件事，Commit Message 建议使用：
   - `feat:` 新功能
   - `fix:` 缺陷修复
   - `docs:` 文档
   - `refactor:` / `perf:` / `chore:` 其他
3. 提交前请确保可编译，并尽量补充 / 通过回归测试。
4. 发起 Pull Request，说明动机、改动点与测试方式（含验证所处环境：代码级 / 模拟器 / 真机）。

## 行为准则

- 保持友善、尊重，就事论事；欢迎不同技术背景的参与者。
- 不接受人身攻击、歧视性或骚扰内容。

## 许可与授权

你提交的贡献将在本项目下以 **Apache License 2.0**（代码）发布；数据相关贡献需与上游词库许可（Apache-2.0 / LGPL-3.0）兼容。提交 PR 即表示你同意该授权方式，并确认你拥有相应内容的权利。
