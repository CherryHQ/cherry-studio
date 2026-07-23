import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import QuickAssistantApp from './QuickAssistantApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css_v2',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'ui.window_style',
    'feature.quick_assistant.assistant_id',
    'feature.quick_assistant.read_clipboard_at_startup'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<QuickAssistantApp />)
