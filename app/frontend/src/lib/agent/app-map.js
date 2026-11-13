// 小G 的「App 地图」：用户问「XX 在哪」，小G 靠这张表回答并把人带过去（go 动作）。
//
// 两件事必须对上：
//   1. 上面这段中文会原样进 system prompt —— 所以要短、要像人话、要能直接对上用户的说法；
//   2. 下面 validPath() 是 go 动作的白名单 —— 模型给出别的路径一律不跳，宁可只回答不动作。
//
// 路由的真身在 App.jsx 第 339-375 行；设置子页的 id 真身在 views/settings-pages.js 的 PAGES。
// 加新页面/新设置页时，两处都要记得回来补这里，否则小G 会把用户带到一个 404 兜底（回首页）。

/** 主要页面，按用户找东西的顺序排。 */
export const SCREENS = [
  { path: '/home', name: '首页', what: '今天练什么、签到、体重、周容量、连续记录' },
  { path: '/plan', name: '计划与日程', what: '上面切换「日程」和「动作组」：日程决定哪天练，动作组决定练哪些动作' },
  { path: '/workout', name: '开始训练', what: '进入今天的训练，记录每组重量和次数' },
  { path: '/history', name: '训练历史', what: '过去的每一次训练，可以翻和改' },
  { path: '/stats', name: '数据统计', what: '力量、容量、部位分布的长周期曲线；个人纪录（最重、最多次、估算 1RM）；体重和训练量叠在一起看' },
  { path: '/library', name: '动作库', what: '全部动作，可以搜索、看要领、加进动作组' },
  { path: '/muscles', name: '按肌肉找动作', what: '三维人体上点一块肌肉（可多选、可搜名字），列出练它的动作；也能把肌肉标成疼痛，之后推荐会绕开它' },
  { path: '/ai-plan', name: 'AI 排计划', what: '按目标一次性生成一份每周安排' },
  { path: '/checkin', name: '签到', what: '每天来签个到：拍张照片，或者只点一下也行，看连续天数；右上角能和上次的照片对比' },
  { path: '/progress-photos', name: '进度照片', what: '所有进度照片，按天看，可以两张对比，也可以按时间轴自动回放变化' },
  { path: '/measurements', name: '围度记录', what: '胸围、腰围、臂围等身体围度' },
  { path: '/body-edit', name: '身体数据', what: '身高体重年龄目标，决定起始重量和容量分配' },
  { path: '/structural-balance', name: '肌群平衡', what: '哪些部位练多了、哪些练少了' },
  { path: '/settings', name: '设置', what: '所有开关和偏好，里面有搜索框，也可以按下面列的子页直接找' },
]

/** 设置子页（/settings/<id>），id 必须和 settings-pages.js 的 PAGES 一致。 */
export const SETTINGS_PAGES = [
  { id: 'modules', name: '模块', what: '整块功能的开关（签到、AI 教练、身体、激励…）' },
  { id: 'workout', name: '训练', what: '休息计时、热身组、每组用力程度、卡片布局' },
  { id: 'alerts', name: '计时提醒', what: '休息结束的声音、震动、语音报数' },
  { id: 'reminders', name: '提醒', what: '训练日提醒、漏练提醒、到健身房提醒' },
  { id: 'plan', name: '计划与日程', what: '固定星期还是循环排队、每周练几次、每周组数目标' },
  { id: 'units', name: '单位与语言', what: '公斤/磅、小数位、语言、1RM 公式、性别年龄' },
  { id: 'equipment', name: '器械', what: '杠铃片、哑铃、杠铃杆、按器械筛选' },
  { id: 'look', name: '外观与首页', what: '深色/浅色、主题色、图标、首页卡片显示哪些' },
  { id: 'coach', name: 'AI 教练', what: '没有单独的设置了 —— 点它直接进入小G 对话' },
  { id: 'data', name: '数据与备份', what: '导出备份、导入、PDF 报告、CSV、清空数据' },
  { id: 'about', name: '关于与更新', what: '版本、检查更新、重看引导、「请喝咖啡」' },
  { id: 'account', name: '本机数据', what: '数据存在哪、本机档案' },
  { id: 'advanced', name: '精细调节', what: '进阶方式、从哪开始算、上组参考、滑动操作等细节' },
  { id: 'gym', name: '健身房提醒', what: '到店自动提醒' },
  { id: 'themes', name: '节日主题', what: '万圣节、圣诞节的装饰' },
]

const SCREEN_PATHS = new Set(SCREENS.map(s => s.path))
const SETTINGS_IDS = new Set(SETTINGS_PAGES.map(p => p.id))

/** 路径合法吗（go 动作的白名单）。查询串和 hash 允许存在，但不参与判断。 */
export function validPath(path) {
  const p = String(path || '').trim().split('#')[0].split('?')[0]
  if (!p.startsWith('/')) return false
  if (SCREEN_PATHS.has(p)) return true
  if (p.startsWith('/settings/')) return SETTINGS_IDS.has(p.slice('/settings/'.length))
  // 动作组编辑页带着 id，属于「打开某一个动作组」，允许。
  return /^\/plan\/r\/[\w-]+$/.test(p)
}

/** 路径的中文叫法，给确认卡片和 summary 用；不认识的返回原路径。 */
export function pathName(path) {
  const p = String(path || '').trim().split('#')[0].split('?')[0]
  const s = SCREENS.find(x => x.path === p)
  if (s) return s.name
  if (p.startsWith('/settings/')) {
    const id = p.slice('/settings/'.length)
    const pg = SETTINGS_PAGES.find(x => x.id === id)
    return pg ? `设置 › ${pg.name}` : '设置'
  }
  if (/^\/plan\/r\//.test(p)) return '动作组编辑'
  return p
}

/** 给 prompt 的地图文本，一行一页。 */
export function mapText() {
  const screens = SCREENS.map(s => `${s.path} —— ${s.name}：${s.what}`).join('\n')
  const settings = SETTINGS_PAGES.map(p => `/settings/${p.id} —— ${p.name}：${p.what}`).join('\n')
  return `【App 的页面】\n${screens}\n\n【设置里的子页】\n${settings}`
}
