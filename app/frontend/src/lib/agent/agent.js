// 小G 的一轮对话：把「App 数据快照 + 最近对话」交给模型，要求它只回一个 JSON：
//   { "reply": "给用户看的中文回复", "actions": [ ...要执行的写操作... ] }
// 默认走服务端 GLM（lib/ai.js 的 ask），也可以走用户自配的 OpenAI 兼容接口。

import { aiBases, extractJson, DEFAULT_MODEL, classifyNetError } from '../ai.js'
import { nativeFetch } from '../capacitor-fetch.js'
import { buildSnapshot } from './snapshot.js'
import { mapText } from './app-map.js'
import { settingsText } from './settings.js'

const ALLOWED = new Set([
  'create-routine', 'rename-routine', 'delete-routine', 'add-exercise', 'remove-exercise',
  'schedule-week', 'schedule-date', 'set-setting', 'set-module', 'log-weighin', 'log-checkin',
  'mark-sore', 'go',
])

function systemPrompt(snapshot) {
  return `你是 yuan-Gym 健身 App 的内置助手，名叫「小G」，是这个 App 的大总管。
你能读取下面这份用户数据快照，也能通过 actions 直接操作 App：建 / 改 / 删「动作组」（一组动作），往动作组里增删动作，把它们排到「日程」（星期几练哪个动作组），直接改设置（重量单位、语言、主题、休息计时……），开关整块功能，记录体重，记一次签到，把某块肌肉标成疼痛（之后推荐动作会自动绕开它），以及把用户带到任意一个页面。
请只输出一个 JSON 对象，不要代码块、不要多余文字：
{"reply":"给用户看的中文回复","actions":[]}

actions 里只允许这些类型：
1) {"type":"create-routine","name":"动作组名","exercises":[{"name":"卧推","sets":4,"reps":8}]}
   计时动作写成 {"name":"平板支撑","sets":3,"sec":45}
2) {"type":"schedule-week","days":{"1":"推日","3":"拉日","5":"腿日"}}
   key 是星期几：0=周日，1=周一，…，6=周六。value 必须是快照 routines 里已经存在的动作组名字，逐字照抄。
   哪天休息就写 "rest"。
3) {"type":"schedule-date","date":"2026-11-12","routine":"推日"}
   只改某一天，routine 写动作组名字；休息写 "rest"。
4) {"type":"rename-routine","from":"旧名字","to":"新名字"}
5) {"type":"delete-routine","name":"推日"}
   删掉一整份动作组；日程里对它的引用会一起清掉。删之前先在 reply 里说清删的是哪一份。
6) {"type":"add-exercise","routine":"推日","exercise":"上斜卧推","sets":4,"reps":8}
   往动作组里加动作；这个动作已经在了就改成新的组数次数。计时动作加 "sec":45，不写 reps。
7) {"type":"remove-exercise","routine":"推日","exercise":"上斜卧推"}
8) {"type":"log-weighin","kg":72.5}
9) {"type":"log-checkin","date":"2026-11-13"}
   不带 date 就是今天。只记「来过」，不拍照。
10) {"type":"mark-sore","muscles":["胸","肩"],"on":true}
   把肌肉标成疼痛（on:false 是取消）。用户说「我昨天练废了」「肩膀疼别给我排推举」时用它。
11) {"type":"go","path":"/settings/units"}
   把用户带到某一页。path 只能取下面地图里出现过的路径，不许自己拼。
12) {"type":"set-setting","key":"unit","value":"lb"}
   直接改一条设置。key 和 value 只能取下面【可以直接改的设置】里的，别自己编 key。
   切单位时数据默认会一起换算；用户说「只改变显示、数字别动」才加 "convert":false。
   例：{"type":"set-setting","key":"restSec","value":120}
13) {"type":"set-module","id":"checkin","on":false}
   开关一整块功能，id 只能取下面【可以开关的模块】里的。

【怎么当一个称职的大总管】
- 你是这个 App 的大总管：用户找不到的东西你指路，用户要改的东西你直接改，别只嘴上说说。
- 用户问「XX 在哪 / 怎么改 / 找不到」：在下面地图里找到那一页，reply 用一句话说清路径（例如「在 设置 → 单位与语言」），同时给一个 go 动作，让他一步到位。
- 用户说「帮我改成… / 换成… / 设成…」：不要只给 go 把人带过去 —— 直接用 set-setting 改掉，reply 一句话说清新值（例如「换好了，现在是磅」）。改完可以顺带给一个 go，让他自己看效果。
- 用户说「把签到 / 激励 / 节日主题这些关了」：用 set-module。
- 用户说「在推日加个上斜卧推 / 把深蹲从腿日删掉 / 给腿日改成 4 组」：用 add-exercise / remove-exercise，一次一条，动作组名字逐字来自快照。
- 用户说「推日不要了 / 删掉那个动作组」：用 delete-routine。这一步不可撤销，reply 里必须点名删的是哪一份。
- 用户说「肩膀疼 / 膝盖不舒服 / 这块先别练」：能对上肌肉就用 mark-sore 标上，然后 reply 说清「接下来推荐会绕开它」。对不上具体肌肉（比如「膝盖」不是训练部位）就只给建议，不要硬标。
- 用户说「我今天来练了 / 帮我签个到」：用 log-checkin。用户要的是拍照签到就 go 到 /checkin，让他自己拍。
- 设置清单里没有的东西（账号、服务器地址、备份文件、导出）不要瞎编 key，也不要动手，只用 go 指路 + 文字说明。
- 数值型设置超出范围时不要硬塞，reply 里说明范围，让他重新给一个数。
- 用户说「帮我排一下 / 排到每天 / 排个日程」：先看快照里有哪些动作组，再用 schedule-week 或 schedule-date 真正写进去。动作组名字必须逐字来自快照；快照里没有就先 create-routine 建出来，同一轮里可以同时给两条动作。
- 用户说「以后每周三练」：days 要给全 —— 练的那几天写动作组，其余写 "rest"，不要只给三天。
- 只回答与训练、饮食、恢复、App 使用相关的内容；语气专业、直接，像真人教练。
- 动作名用常见中文名（卧推、深蹲、硬拉、引体向上、哑铃弯举…）。
- 不确定那一页存在，就不要给 go，用文字说；没有需要改的数据时 actions 必须是空数组。
- 不要编造用户没提供的数据；不确定时宁可少写。

${settingsText()}

${mapText()}

用户数据快照（JSON）：
${JSON.stringify(snapshot)}`
}

function historyPrompt(history) {
  const turns = (Array.isArray(history) ? history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'agent') && m.text)
    .slice(-10)
  const lines = turns.map(m => `${m.role === 'user' ? '用户' : '小G'}：${m.text}`)
  lines.push('小G：')
  return lines.join('\n')
}

function parse(text) {
  const raw = extractJson(text)
  try {
    const obj = JSON.parse(raw)
    if (obj && typeof obj === 'object') {
      return {
        reply: typeof obj.reply === 'string' ? obj.reply : '',
        actions: Array.isArray(obj.actions) ? obj.actions.filter(a => a && ALLOWED.has(a.type)) : [],
      }
    }
  } catch { /* 不是 JSON，按纯文本回答处理 */ }
  return { reply: String(text || '').trim(), actions: [] }
}

function byokUrl(baseUrl) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '')
  return /\/chat\/completions$/.test(base) ? base : `${base}/chat/completions`
}

// 默认 GLM：请求我们自己的 /ai 代理（Key 在 worker 上）。
// 生产环境 App 主机是纯静态站，/ai 只能走 Worker 的绝对地址（候选见 lib/ai.js 的 aiBases）。
async function glmPost(url, system, prompt) {
  try {
    const r = await nativeFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        temperature: 0.5,
        maxTokens: 2500,
        // 点名可用的型号：Worker 的默认 glm-4.7-flash 现在恒 429（lib/ai.js 有说明）。
        model: DEFAULT_MODEL,
      }),
      signal: AbortSignal.timeout(75_000),
    })
    const body = await r.json().catch(() => null)
    if (!r.ok || !body?.ok) return { ok: false, reason: body?.error || `http_${r.status}` }
    const text = String(body.text || '').trim()
    if (!text) return { ok: false, reason: 'empty' }
    return { ok: true, text }
  } catch (err) {
    return { ok: false, reason: classifyNetError(err), detail: String(err?.message || err) }
  }
}

async function glmAsk(system, prompt) {
  // 候选域名由 lib/ai.js 统一给（成功的排前面），别再自己拼 apiBase()——单机包里它是空串，
  // 同源的 /ai 只会拿到 index.html。
  let last = { ok: false, reason: 'network' }
  for (const url of aiBases()) {
    last = await glmPost(url, system, prompt)
    if (last.ok) return last
  }
  return last
}

async function byokAsk(cfg, system, prompt) {
  const url = byokUrl(cfg.baseUrl)
  const body = {
    model: cfg.model,
    messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
    temperature: 0.5,
  }
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` }
  // nativeFetch 而不是 fetch：手机 WebView 的 origin 是 capacitor://localhost，任何不支持这个
  // origin 的服务商都会在预检就被拒；原生请求没有 CORS 这回事。浏览器里它自动退回 fetch。
  const send = payload => nativeFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(75_000),
  })

  try {
    let r = await send({ ...body, response_format: { type: 'json_object' } })
    // 有的兼容接口不认 response_format，退回普通请求再试一次。
    if (r.status === 400 || r.status === 422) r = await send(body)
    const json = await r.json().catch(() => null)
    if (!r.ok) {
      return { ok: false, reason: json?.error?.message || `http_${r.status}` }
    }
    const text = json?.choices?.[0]?.message?.content
    if (!text) return { ok: false, reason: 'empty' }
    return { ok: true, text: String(text) }
  } catch (err) {
    return { ok: false, reason: classifyNetError(err), detail: String(err?.message || err) }
  }
}

/**
 * @param {{history: Array<{role:'user'|'agent',text:string}>, S: object, cfg: object}} args
 * @returns {Promise<{ok:true, reply:string, actions:Array} | {ok:false, reason:string}>}
 */
export async function askAgent({ history, S, cfg }) {
  const system = systemPrompt(buildSnapshot(S))
  const prompt = historyPrompt(history)

  const res = cfg?.mode === 'byok'
    ? await byokAsk(cfg, system, prompt)
    : await glmAsk(system, prompt)
  if (!res.ok) return { ok: false, reason: res.reason }

  const { reply, actions } = parse(res.text)
  return { ok: true, reply: reply || '（小G 没有生成文字回复）', actions }
}
