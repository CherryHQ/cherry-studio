import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { createRoot } from 'react-dom/client'

import ScreenshotSelection from './ScreenshotSelection'

loggerService.initWindowSource('ScreenshotSelection')

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(
  <ThemeProvider>
    <ScreenshotSelection />
  </ThemeProvider>
)
