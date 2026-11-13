/**
 * AGPL v3 §5 / §6 的法律声明常量。
 *
 * 所有「以后可能要换」的地址集中在这里，改这一处即可，不用碰 Settings.jsx：
 *
 * - SOURCE_BUNDLE：随 App 一起分发的完整对应源码包（放在 public/source/ 下，
 *   vite build 会原样拷进 dist，再随 cap sync / syncpub 打进 APK）。
 *   **不需要 GitHub / Gitee / 任何账号** —— 拿到 APK 的人就同时拿到了源码；
 *   离线也能打开。对应 AGPL §6「同时提供机器可读的 Corresponding Source」。
 * - SOURCE_PAGE：可选。若另外把同一份源码包放到自己的网站或代码托管，
 *   把公开地址填进来，设置页会同时显示，用于满足 §6(d)「同一位置、
 *   不额外收费提供源码」以及 NOTICE.md 里 App store exception 的
 *   「corresponding source code remains available at the project repository」前提。
 *   留空 = 只用随包源码包（直接分发/自建站下载场景已足够）。
 *   Vite 的 base 是 './'，HashRouter 的页面地址是 index.html#/settings/about，
 *   所以相对 './source/…' 会解析到 assets 根目录，Android/iOS WebView 都能取到。
 *
 * 许可证全文与第三方声明也随包内置（public/LICENSE.txt、public/NOTICE.md），
 * 这样离线状态下同样满足 Appropriate Legal Notices 的
 * 「告诉用户如何查看本许可证的副本」（LICENSE:91-98）。
 *
 * 法律文本不做本地化：所有语言界面保持同一份英文措辞，避免翻译造成含义偏移。
 */
const base = import.meta.env?.BASE_URL || '/'

export const APP_MODIFIED_DATE = '2026-11-12'
export const UPSTREAM_NAME = 'openGym'
export const UPSTREAM_COPYRIGHT = 'Copyright (C) 2026 Duarte Santos'
/** 若要主张自己对新增部分的版权，把这里换成你的法定姓名；留空不影响 §5 合规。 */
export const MODIFIER_COPYRIGHT = 'Modifications (C) 2026 the yuan-Gym contributors'
export const LICENCE_NAME = 'GNU Affero General Public License v3.0'

export const SOURCE_BUNDLE_NAME = 'yuan-Gym-source.zip'
export const SOURCE_BUNDLE = base + 'source/' + SOURCE_BUNDLE_NAME
export const SOURCE_PAGE = 'https://github.com/YUan241813/yuan-Gym' // 公开源码仓库（AGPL §6 网络获取）
export const LICENCE_FILE = base + 'LICENSE.txt'
export const NOTICES_FILE = base + 'NOTICE.md'
export const MODIFICATIONS_FILE = base + 'MODIFICATIONS.txt'
export const SOURCE_README_FILE = base + 'SOURCE-README.md'
