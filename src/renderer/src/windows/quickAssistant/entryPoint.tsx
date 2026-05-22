import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import QuickAssistantApp from './QuickAssistantApp'

loggerService.initWindowSource('QuickAssistant')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<QuickAssistantApp />)
