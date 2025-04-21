import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'

if (location.hash === '#/mini') {
  document.getElementById('spinner')?.remove()
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<MiniApp />)
} else {
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<App />)
}
