// 小G（内置 App Agent）的本地配置。
//
// 默认走服务端 GLM（/ai，Key 在 worker 上，浏览器不接触）。
// 也可以让用户填自己的 OpenAI 兼容接口 + Key，直接请求，不经我们的服务器。
// 这份配置只存本机 localStorage，绝不进 S，因此不会同步到账号或别的设备。
//
// fullAccess：是否允许小G 不经确认直接改数据。默认关闭（false）。

const KEY = 'yuangym_agent_v1'

export const AGENT_DEF = {
  mode: 'glm',        // 'glm' | 'byok'
  baseUrl: '',        // 例如 https://api.openai.com/v1
  model: '',          // 例如 gpt-4o-mini
  apiKey: '',
  fullAccess: false,
}

export function loadAgentConfig() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || '{}')
    return { ...AGENT_DEF, ...(raw && typeof raw === 'object' ? raw : {}) }
  } catch {
    return { ...AGENT_DEF }
  }
}

export function saveAgentConfig(patch) {
  const next = { ...loadAgentConfig(), ...(patch || {}) }
  try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* 隐私模式忽略 */ }
  return next
}

/** 这份配置能不能真的发请求。 */
export function agentReady(cfg) {
  if (cfg?.mode === 'byok') return Boolean(cfg.baseUrl && cfg.apiKey && cfg.model)
  return true
}
