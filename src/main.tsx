import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { isNativeApp } from './lib/ota'

try {
  document.documentElement.dataset.shell = isNativeApp() ? 'native' : 'web'
} catch {
  document.documentElement.dataset.shell = 'web'
}

// 点按后立刻取消焦点，避免 WebView 残留蓝框
function clearTapFocus(e: Event) {
  const el = e.target
  if (!(el instanceof HTMLElement)) return
  if (!el.matches('button, a, .day, [role="button"], [role="tab"]')) return
  window.requestAnimationFrame(() => el.blur())
}
document.addEventListener('touchend', clearTapFocus, true)
document.addEventListener('mouseup', clearTapFocus, true)

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

