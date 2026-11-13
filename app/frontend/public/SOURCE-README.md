# yuan-Gym 1.4.14 — 完整对应源码（Corresponding Source）

> 本文件说明随 App 内置的 `yuan-Gym-source.zip` 里有什么、怎么构建、以及哪些东西**没有**放进来、为什么。
> 依据：GNU AGPL v3.0 §1（Corresponding Source 定义）、§5（修改版声明）、§6（随目标码提供源码）。

## 一、这个包解决什么问题

AGPL §6 要求：分发编译后的目标码（APK）时，必须同时提供**机器可读的完整对应源码**。
传统做法是给一个 GitHub 仓库地址，但那需要账号、需要网络、且仓库可能被删。

**本 App 采用 §6 允许的另一种方式：把源码包直接打进 APK。**
拿到 APK 的人同时就拿到了源码，离线可用、不额外收费、不需要任何账号或仓库。
设置页「关于与更新 → 开源与法律」里点「源代码」即可保存/分享这个 zip。

- 直接分发 APK / 自建站下载：**这样已经满足 §6**。
- 若日后上架 Google Play / App Store：`NOTICE.md` 的「App store exception」（§7 附加许可）
  额外要求源码「在项目仓库持续以 AGPL 公开」。那时只需把**同一个 zip** 上传到任意公开
  （Gitee、自建站、网盘直链均可，不必是 GitHub），再把地址填进
  `app/frontend/src/lib/legal.js` 的 `SOURCE_PAGE` 常量即可，设置页会自动多显示一个入口。

## 二、包里有什么

以 `yuan-Gym/` 为根目录，路径与本地工作区一致：

| 路径 | 内容 |
|---|---|
| `LICENSE` | GNU AGPL v3.0 全文 |
| `NOTICE.md` | 第三方声明与授权 + App store exception |
| `CLA.md` | 贡献者许可协议 |
| `MODIFICATIONS.txt` | §5(a) 修改声明、日期、改动清单（也在 App 内可查） |
| `SOURCE-README.md` | 本文件 |
| `README.md` / `CONTRIBUTING.md` / `CHANGELOG.md` / `SECURITY.md` / `ROADMAP.md` / `CLAUDE.md` | 项目文档 |
| `DIFF-vs-openGym.md` | 相对上游的完整功能差异清单 |
| `.env.example` / `.dockerignore` / `.gitignore` | 配置模板（不含真实值） |
| `app/frontend/src/**` | 全部前端源码（含测试） |
| `app/frontend/public/**` | 图标、manifest、service worker、3D 模型、法律文本 |
| `app/frontend/scripts/**` | 构建 / 校验脚本 |
| `app/frontend/{package.json,package-lock.json,vite.config.js,capacitor.config.json,index.html}` | 构建入口与依赖锁 |
| `app/frontend/android/**` | Capacitor Android 原生工程（Java、res、Manifest、gradle） |
| `app/frontend/ios/**` | Capacitor iOS 原生工程 |
| `app/catalogue/exercises/**` | 6554 个动作 JSON（文本许可见 `NOTICE.md`） |
| `app/catalogue/i18n/**` | 19 个语言包 |
| `app/catalogue/browse/**` | 目录索引 |
| `app/catalogue/media/NOTICE.md` | 媒体版权声明 |
| `app/scripts/**` | 媒体装配 / 目录构建脚本（含 `catalogue/stage-media.mjs`、`build.mjs`） |
| `app/api/coach/core/**` | 前端 import 的 AI 核心模块 |
| `app/{package.json,package-lock.json,LICENSE,NOTICE.md,...}` | 工作区级配置与许可 |
| `scripts/**` | 顶层构建脚本 |

## 三、怎么重建

这个 zip 由 `app/frontend/scripts/pack-source.mjs` 生成，可重复执行。每次改完源码
（或替换建模资产）都要重新生成，再构建 APK，保证包内源码与 APK 实际内容一致：

```bash
cd app/frontend
npm ci                         # 依赖由 package-lock.json 精确复现
npm run pack:source            # 重新生成 public/source/yuan-Gym-source.zip
VITE_MOBILE=1 VITE_CLIP_EXT=webp npx vite build
node scripts/check-mobile-bundle.mjs
node syncpub.mjs               # 增量复制 dist -> android assets/public（本机链路，替代 cap sync）
cd android
./gradlew assembleSideloadRelease
```

需要 Node 22+、JDK 21、Android SDK（platforms/build-tools 34~36）。
产物：`android/app/build/outputs/apk/sideload/release/app-sideload-release.apk`。

## 四、刻意排除的内容及原因

| 排除项 | 原因 |
|---|---|
| `node_modules/`、Gradle 缓存 | 依赖，由 `package-lock.json` 可精确再生；§1 不要求包含通用工具与可自动再生的东西 |
| `dist*`、`android/app/build/`、`android/app/src/main/assets/public/`（约 691 MB）、`ios/App/App/public/`、各 `db*`、`.check`、截图、日志、`.src.zip`、APK | 构建产物 / 调试副本，可再生；`assets/public` 是 `syncpub.mjs` 拷进去的 dist，内含第三方媒体 |
| **动作媒体二进制**（`app/catalogue/media/clip|still`、assets 里的 `exercise-media/`） | **版权不属于本项目**：© Aliaksandr Makatserchyk / Gym visual，不受 AGPL 覆盖，NOTICE.md 明确禁止第三方复用。生成/装配脚本与媒体声明已包含，但二进制不能随源码再分发 |
| `worker/.secrets.env`、`server/config.json`、`worker/.cf-token`、`server/data/` | 真实凭据与运行时用户数据，必须保密 |
| `android/keystore.properties`、`android/keystore/*.jks`、`android/local.properties` | 签名私钥、明文口令、本机 SDK 绝对路径；不属于源码，公开会有安全风险 |
| `design/anatomy-model/` | 第三方原始素材，非本项目源码 |
| `app/api/password.js`、`app/helm/templates/secret.yaml`、`src/lib/coach-secrets.js` | **已保留**（是哈希/策略源码与 Helm 模板，不含真实凭据） |

> 排除签名密钥意味着：用这份源码可以构建出 **debug** 版，但无法复现官方 release 签名；
> 这是刻意的安全取舍，不影响 AGPL 对「源码可构建、可修改」的要求。

## 五、⚠️ 两个尚未解决的合规条件（收费分发前必须处理）

1. **媒体授权（决定性）**：`NOTICE.md` 写明「A commercial fork, or any other use, needs its own
   licence from gymvisual.com」。现用 6554 段动画 + 静帧是打包进 APK 的大尺寸版本，且商业用途
   不在豁免内。要么向 gymvisual.com 购买**明确覆盖「打包进 APK + 随源码分发 + 商用」**的书面授权，
   要么把整套媒体换成你有权分发的素材（自有 / 公共领域）。**声明和源码包都不解决这个问题。**
2. **无死角重建**：APK 内约 634 MB 的高清动画来自 `APP_MEDIA_DIR` 私有副本，工作区内没有对应
   源；即便取得授权，从这份源码也需自备该素材才能 1:1 重建出同款 APK。

本源码包与设置页声明解决的是 **AGPL 代码层面的 §5 / §6 义务**，不含上述两项。
另：`src/lib/update.js` 的自动更新仍指向一个已失效的仓库地址，属独立产品缺陷，与许可合规无关。

---
*我不是律师；正式商业分发前请由知识产权律师复核。*
