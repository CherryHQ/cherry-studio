import { reactScanConfig } from '@renderer/config/reactScan.config'
import { scan } from 'react-scan'

if (import.meta.env.RENDERER_VITE_REACT_SCAN === 'true') {
  scan(reactScanConfig)
}

import './assets/styles/index.css'
import './assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { createRoot } from 'react-dom/client'

import App from './App'

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
