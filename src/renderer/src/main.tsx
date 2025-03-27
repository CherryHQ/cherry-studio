import './assets/styles/index.scss'

import ReactDOM from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'

console.log('main.tsx开始执行')

if (location.hash === '#/mini') {
  console.log('准备渲染MiniApp')
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MiniApp />)
} else {
  console.log('准备渲染主App')
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}

console.log('main.tsx执行完成')
