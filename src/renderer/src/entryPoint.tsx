import './assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'

// Set platform attribute for CSS platform-specific variables
;(() => {
  try {
    const ua = navigator.userAgent.toLowerCase()
    const platform = ua.includes('mac')
      ? 'mac'
      : ua.includes('win')
        ? 'win'
        : ua.includes('linux')
          ? 'linux'
          : 'unknown'
    document.documentElement.setAttribute('data-platform', platform)
  } catch {
    // noop
  }
})()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
