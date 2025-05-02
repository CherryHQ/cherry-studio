import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'
import CSSEditorApp from './windows/csseditor/App'

if (location.hash === '#/css-editor') {
  document.getElementById('spinner')?.remove()
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<CSSEditorApp />)
} else {
  const root = createRoot(document.getElementById('root') as HTMLElement)
  root.render(<App />)
}
