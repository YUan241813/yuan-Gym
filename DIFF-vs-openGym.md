# yuan-Gym 1.4.10 相对 openGym 原版：功能差异清单

> **口径说明（必读）**
> - 本仓库**不是 git 仓库**，无法做逐行 `git diff`。本清单 =「openGym 原版 `README.md` 功能基线」+「2026-11-09 ~ 11-12 四份工作日志的全部改动记录」+「当前源码文件实存核验」三方交叉整理，**是人工梳理的功能级差异，不是逐行代码比对**。
> - 「原版」指上游 `github.com/DuarteSantos8/openGym` 的功能集（以仓库内 `README.md` 的 Features 章节为准）。
> - 「成品」指当前手机上的 **yuan-Gym 1.4.10**（Android sideload release，纯本地单机版）。
> - 标注区分：**删代码**（文件已从磁盘移除）／**仅停用**（文件还在，但路由/引用已切断，运行时不可达）。

---

## A. 新增或重写的功能（原版没有，或形态完全不同）

| # | 功能 | 说明 | 原版对应 | 主要落点 |
|---|---|---|---|---|
| A1 | **3D 人体解剖建模（Écorché）** | 用户自建的 176 肌束 / 124 可点细块 / 44.9 万顶点解剖模型，接入 App；支持**逐块点击**、**解剖学精确名**（三角肌前/中/后束等）、**多选高亮**、按选中部位推荐最贴合动作 | 原版只有平面 body map（正/背面示意图） | `src/lib/anatomy/`（ecorche.js / skin.js / normalize.js / gltf-body.js / custom-body.js）、`BodyModel3D.jsx`、`BodyMap3D.jsx`、`muscle-facts.js`、`plan-engine.js` |
| A1a | └ 3D 模型**就地替换** `/muscles` 页的平面图 | 不是新增入口卡片，而是把平面示意图换成可旋转 3D 人体 | 平面图 | `views/Muscles.jsx` → `BodyMap3D` |
| A1b | └ 皮肤层 + 中性化 | 基于 `ashemag/human-atlas` / BodyParts3D 4.0（**CC BY 4.0**，需署名）做连续皮肤网格，性征贴片压平、法线重算 | 无 | `public/models/ecorche-skin.bin`、`.ana-attribution`、`third_party/ATTRIBUTION.md` |
| A1c | └ 骨架透视 / 骨骼可见 | 骨骼半透明 + `depthTest:false` 隔着肌肉可见 | 无 | `BodyModel3D.jsx` |
| A2 | **小G AI 助手（App 大总管）** | 原版 AI coach 被重做成：①聊天记录保留（30 分钟内续聊、可开新对话但历史不丢）②能把训练计划**排进每天日程** ③能在对话里**直接改设置**（24 项白名单 + 模块开关）④能指路/代操作打开任意功能 | 原版是 "AI coach"：起草一周计划、按记录建议改动、回答训练问题，跑在自己服务器/手机、自带 provider key | `views/Assistant.jsx`、`lib/agent/{agent,settings,actions,app-map}.js` |
| A2a | └ AI 排计划**落库** | 读近 28 天真实训练记录 → 自动补薄弱部位 → 生成计划 → 一次写入 `S.routines`（计划页直接可见可开练）；本地规则引擎可离线跑，LLM 只做增强 | 原版 `/ai-plan` 对 store **零写入**，只存在 useState | `views/AiPlan.jsx`、`lib/plan-to-routines.js`、`lib/plan-engine.js` |
| A2b | └ 自建 AI 后端 | 走 `https://api.yuanzq.top/ai`（智谱 GLM，key 在 Cloudflare Worker，App 内不含 key）；带多域名候选、网络错误分类、中文提示 | 原版走自托管 `/ai` 或用户自带 key | `lib/ai.js`（REMOTE_BASES / aiBases / classifyNetError / aiFailHint） |
| A2c | └ 术语改名 | 「训练计划」→「动作组」（routine），排到哪天 = 日程 | 原版 routine 即训练计划 | 全 UI + locale |
| A3 | **拍照签到 / 双类型签到** | 原版 CheckIn 是「健身房会员卡二维码/条码」。重做成：训练前后拍一张记录每日变化；拆**普通签到**（点一下）+ **拍照签到**；照片**可删除**（删了仍算签到，Undo 可恢复）；连续天数按签到记录算 | 会员卡（gymCards 二维码/条码） | `views/CheckIn.jsx`、`lib/check-ins.js`（`S.checkIns` 墓碑机制）、`sync-merge.js` / `sync-stamps.js`（STAMPED_MAPS + OWN_MERGE）、`ProgressPhotos.jsx` |
| A3a | └ 拍照直起相机修复 | Android `<queries>` 补 `IMAGE_CAPTURE`（原只声明了 VIDEO_CAPTURE，导致拉起相册） | — | `android/app/src/main/AndroidManifest.xml` |
| A4 | **应用内收款码弹窗** | 「请喝咖啡」不再跳网页，改成 App 内直接弹**微信收款码**图片（可点背景/Esc/返回键关闭） | 原版是 BuyMeACoffee / Ko-fi / GitHub Sponsors 三条外链 | `views/Settings.jsx`（openSheet 弹窗）、`public/support-yuan-gym.jpg` |
| A5 | **用户自有图标 / 品牌全套替换** | 蓝发举哑铃二次元插画替换绿色哑铃（9 个变体 + Android 6 密度 mipmap）；openGym→yuan-Gym、opengym.ch→yuanzq.top、状态键 `yuangym_state_v1`、备份/CSV 前缀、通知文案中文、桌面名、默认中文 | 上游绿色哑铃 + 英文默认 | `design/icons/`、`resources/icons/`、`scripts/app-icons.mjs`、`tools/rebrand.mjs`、`useStore.js`、`index.html`、Android/iOS strings |
| A5a | └ 正式版自有签名 | 自建 keystore（`CN=yuan-Gym`）替代上游作者签名，release 可覆盖安装 | 上游 `CN=openGym, O=Duarte Santos` | `android/keystore/`、`build.gradle` signingConfig |
| A6 | **「本机数据」设置页** | 去掉账号后，账号页整块换成「本机数据」：只存本机 / 导出备份 / 导入备份 / 自动备份 | 原版 account 页（登录/同步/配对设备） | `views/Settings.jsx`、`settings-pages.js` |
| A7 | **计划页动作行内动画预览** | `Thumb`（仅静帧）→ `MediaPreview`（静帧垫底 + 进屏才播 + 解码完成才淡入）；顺带补齐 2887 张静帧，覆盖率 100% | 原版列表用静态缩略图 | `views/RoutineEdit.jsx`、`components/Media.jsx`、`scripts/catalogue/gen-stills-from-clips.py` |

## B. 改造 / 增强（功能框架沿用原版，内容被重做）

| # | 项 | 改动 |
|---|---|---|
| B1 | **动作演示媒体** | 原版 mp4（12 帧 / 2~3 秒 / ≈4-5fps，看起来像"两帧闪"，且 WebView `<video>` 循环卡顿）→ 全转**动画 WebP**（24~48 帧 / 12fps / 交叉淡入补间，不经视频播放器）；覆盖从 2233 段补到 **6554 段**全动画，静帧补到 6554 |
| B2 | **默认语言** | 英文默认 → **中文**默认（`detectedLang()` 兜底 `'en'`→`'zh'`，旧档 `langAuto` 重新探测，index.html 预渲染同步改） |
| B3 | **离线化打包** | 动作库动画 + 静帧 + 3D 模型全部打进 APK（`aaptOptions noCompress 'webp'`），成品 APK ≈694MB，除 AI 外完全离线；原版走自托管服务器 + Docker |
| B4 | **构建/发布链路** | 自建 vite→stage-media→syncpub→gradle 链路、repack-apk-assets 增量重打包、check-mobile-bundle / audit-media-coverage 护栏；绕开被沙箱拦截的 `cap sync` |

## C. 删除 / 停用的功能（原版有，成品没有）

| # | 功能 | 原版状态 | 状态 | 备注 |
|---|---|---|---|---|
| C1 | **账号体系 / 登录注册** | Passkeys、用户名+密码、新设备配对码/QR、`ALLOW_GUEST`、profile 切换 | **仅停用** | `authed` 恒 `true`、`/account`→`/home`、删 Login/Account 的 import 与 lazyView；`Login.jsx`/`Account.jsx` **文件仍在磁盘**但运行时不可达；首启直接 `chooseLocalMode()` |
| C2 | **跨设备同步 / 云端** | 整份 state 同步、`rev`、12s 轮询、字段级合并 | **停用** | 改为纯本地单机，数据只存手机 |
| C3 | **自托管后端全套** | Docker Compose、Node server (`server/`)、Cloudflare Tunnel、Worker + D1、admin dashboard、邀请码注册、活动日志、邮件验证码、PBKDF2 密码 | **停用/废弃** | 早期（11-09）曾完整搭通并部署，11-10 改「纯本地单机版」后整体不再接入；相关代码仍散落仓库但成品不使用 |
| C4 | **AI Coach 独立模块** | `/coach` intake / proposal / setup 三页 + 自带 provider key（Anthropic / OpenAI / Gemini / Ollama） | **仅停用+并入** | `/coach*` 全部 `<Navigate to="/assistant">`，懒加载删除，能力并入小G |
| C5 | **Hevy 导入** | Import from Hevy（CSV / API key）+ 标题映射表 | **删代码** | `import-hevy.js` / `import-hevy.test.js` / `hevy-id-map.js`(609 行) / `import-csv.js` 的 Hevy 分支 / 19 个 locale 的 Hevy 键全部移除；导入只留 Import backup + Import from another app |
| C6 | **健康设备数据接入** | Health Connect（Android）/ Apple Health·HealthKit（iOS）双向：训练写出去、心率/体重读进来 | **删代码** | `health-sync.js` / `health-connect.js` / `health-read.js` / 原生 `HealthConnectPlugin.java` / `AppleHealthPlugin.swift` / Info.plist 的 NSHealth* / entitlements 全删；**保留**手动体重 + 体重图表 + 每组 ♥ 心率标签展示 |
| C7 | **自研手表训练联动** | Apple Watch App（数字表冠勾组、全屏休息倒计时、每组心率）、Wear OS、`android/wear/`、`ios/App/Watch*` | **删代码** | `watch-sync.js` / `phone-workout.js` / `watch-relay.js` / `watch-settings.js` / WatchBridge / pbxproj 20 项 / `ci/add-watch-app.rb` 全删；用户明确「连自研的一起删，以后重做」 |
| C8 | **第三方手环/手表品牌接入** | Garmin / Fitbit / Withings / COROS 等 | **删代码** | 先收窄到国内 5 家（华为/小米/OPPO/vivo/荣耀）+ 苹果，后随手表功能整体下线；另删 `garmin-snapshot.js`、`.fit` 导出、Garmin/Zepp 相关测试 |
| C9 | **Webhook / MCP server** | 集成页里的 signed webhooks（Home Assistant / n8n / ntfy）、MCP server（Claude Desktop 查训练历史） | **删代码** | `integrations.js` 的 WEBHOOK_EVENTS / normalizeWebhookUrl、`Integrations.jsx` 卡片、模块开关（12→11）全删 |
| C10 | **「集成」设置页 / 集成页** | Integrations 独立页面 | **删代码** | `views/Integrations.jsx` 整页删除，导入入口迁移到「数据&备份」页；小G 认知同步删除「集成」别名与导航项 |
| C11 | **锻炼前后对比 / 体态快照** | —（注：这是 **A1 过程中用户自己加过、又主动删掉** 的功能，不是原版功能） | **删代码** | `Anatomy.jsx` 的增益滑块（选中肌肉鼓 60%）、体态快照蓝色线框幽灵对比、SNAP_KEY 全删；用户第三轮明确「去掉前后对比」 |
| C12 | **皮肤/骨架三层显示 UI 开关** | —（同为 A1 过程中加过又回滚） | **删代码** | 1.4.5 用户要求「回滚到纯肌肉模式」：`showBones` / `showSkin` / `bonesThrough` / `trainingCompare` 的 UI 按钮删除；**模型资产与底层代码仍在**，只是界面不暴露 |
| C13 | **三条赞助外链** | BuyMeACoffee / Ko-fi / GitHub Sponsors | **删代码** | 换成 A4 应用内收款码弹窗 |
| C14 | **会员卡签到** | gymCards 二维码/条码、扫卡/相册导入 | **删代码** | 整页重写为 A3 拍照签到 |
| C15 | **Recovery tips 挂靠 health 模块** | 原随模块开关显示 | **改为常显** | 从 `on('health')` 摘出改无条件显示（属保留，非删功能） |

## D. 曾做过、但现在成品里没有的（避免误以为成品含这些）

- Cloudflare Worker + D1 账号系统、双域名部署（`yuan-gym.yuanzq.top` / `api.yuanzq.top`）、免邮箱注册、admin 控制台重置密码、Brevo/Resend 邮件、PBKDF2-SHA512 密码体系 —— 11-09 全部搭通并上线验证，11-10 转「纯本地单机版」后**整体不再接入 App**（AI 后端只保留了 `api.yuanzq.top/ai` 这一条）。
- 个人站点 `yuan-site` 新增 yuan-Gym 项目页 + 收款码区块 —— 属**另一个仓库**，不在本 App 内。
- 皮肤放样（分段充气 mannequin）方案 —— 判定像木头人偶、走死后废弃，改用 human-atlas 开源皮肤数据。
- Garmin / Zepp 手表页、`.fit` 导出 —— 第五轮删除。

---

## E. 从「哪些是我自己的」角度看（呼应你之前的闭源/clean-room 评估）

- **相对干净、可视为你自己原创的**：A1 的 3D 解剖模型（你交付的资产）、`lib/anatomy/*` 解码与渲染管线、A3 拍照签到 / `check-ins.js`、A4 收款码弹窗、A5 图标插画与品牌美术、B1 动画 WebP 加工产物、C11/C12 的产品取舍。这些是你自己的表达，**理论上可以作为干净重写的素材**（但 A1b 皮肤数据来自 CC BY 4.0，需保留署名）。
- **仍是 openGym 的**（不能带进闭源）：底层训练/计划/进度的数据模型与业务逻辑、动作文本目录、整套 UI 框架与路由、`README.md` 里列的 Planning/Training/Progress 三大块功能实现、19 个语言包。C 列删掉的那些**也仍是原版代码**，只是被你停用/移除，不代表变成你的。
- **独立的法律雷区**：动作**媒体**（6554 动画 + 静帧）版权是 **Gym visual**（gymvisual.com，© Aliaksandr Makatserchyk），既不是 openGym 的也不是你的，不受 AGPL 覆盖；随包 NOTICE 明确禁止第三方复用。详见单独抽出的 `D:\Self-developedSoftware\yuan-Gym-media\NOTICE.md`。
- 结论：差异清单能帮你划清"我做了什么"，但**改变不了**「整体仍是 AGPL 衍生作品」这个法律定性——除非走 clean-room 重写或取得作者专有许可。

---
*整理日期：2026-11-12。依据：仓库 `README.md`、`.workbuddy/memory/2026-11-{09,10,11,12}.md`、当前 `app/frontend/src` 文件实存核验。我不是律师，正式 IP 决策请咨询知识产权律师。*
