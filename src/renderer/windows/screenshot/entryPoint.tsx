import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import ScreenshotApp from './ScreenshotApp'

// No `ui.custom_css` here (nor `useCustomCss` in the app): the overlay is a pixel-aligned
// full-screen canvas, and one stray user rule would offset the selection from what is captured.
await prepareWindow({
  preference: [
    'app.language',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'ui.theme_user.font_family',
    'ui.theme_user.code_font_family',
    'feature.screenshot.auto_ocr'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<ScreenshotApp />)
