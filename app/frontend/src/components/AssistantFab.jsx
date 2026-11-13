import { useNavigate } from 'react-router-dom'
import Icon from './Icon.jsx'

// 小G 的全局入口：主页面右下角的悬浮球。
export default function AssistantFab() {
  const nav = useNavigate()
  return <button className="ag-fab" onClick={() => nav('/assistant')} aria-label="小G"><Icon name="sparkles" /></button>
}
