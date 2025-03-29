import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'
import CSSEditor from './windows/csseditor/App'

if (location.hash === '#/mini') {
  document.getElementById('spinner')?.remove()
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<MiniApp />)
} else if (location.hash === '#/css-editor') {
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<CSSEditor />)
} else {
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<App />)
}
