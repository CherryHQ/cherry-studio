import '@ant-design/v5-patch-for-react-19'
import '@renderer/assets/styles/index.css'

import { loggerService } from '@logger'
import { createRoot } from 'react-dom/client'

import TestApp from './TestApp'

loggerService.initWindowSource('DataRefactorTestWindow')

const root = createRoot(document.getElementById('root') as HTMLElement)

root.render(<TestApp />)
