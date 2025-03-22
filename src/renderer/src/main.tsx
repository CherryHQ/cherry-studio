import './assets/styles/index.scss'

import ReactDOM from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'
import CSSEditor from './windows/csseditor/App'

if (location.hash === '#/mini') {
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MiniApp />)
} else if (location.hash === '#/css-editor') {
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<CSSEditor />)
} else {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}
