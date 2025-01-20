import './assets/styles/index.scss'

import ReactDOM from 'react-dom/client'

import App from './App'
import MiniApp from './windows/mini/App'

if (location.hash === '#/mini') {
  document.getElementById('spinner')?.remove()
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<MiniApp />)
} else {
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(<App />)
}
