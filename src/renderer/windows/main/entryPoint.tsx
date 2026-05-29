import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import MainApp from './MainApp'

// Initialize logger for this window
loggerService.initWindowSource('mainWindow')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MainApp />)
