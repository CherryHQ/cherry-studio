import './assets/styles/index.scss'

import ReactDOM from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'

// 添加全局错误处理器来捕获未处理的错误
window.addEventListener('error', (event) => {
  console.error('全局错误捕获:', {
    message: event.error?.message,
    stack: event.error?.stack,
    type: event.error?.name,
    location: `${event.filename}:${event.lineno}:${event.colno}`
  })

  // 可选：将错误信息存储到本地存储以便后续分析
  try {
    const errors = JSON.parse(localStorage.getItem('app_errors') || '[]')
    errors.push({
      timestamp: new Date().toISOString(),
      message: event.error?.message,
      stack: event.error?.stack,
      type: event.error?.name
    })
    localStorage.setItem('app_errors', JSON.stringify(errors.slice(-10))) // 只保留最近10条错误
  } catch (e) {
    console.error('存储错误信息失败:', e)
  }
})

// 添加未处理的Promise拒绝处理器
window.addEventListener('unhandledrejection', (event) => {
  console.error('未处理的Promise拒绝:', {
    reason: event.reason
  })
})

if (location.hash === '#/mini') {
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MiniApp />)
} else {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}
