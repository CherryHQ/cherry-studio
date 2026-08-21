import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import QuickAssistantApp from './QuickAssistantApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'feature.quick_assistant.assistant_id',
    'chat.input.send_message_shortcut',
    'chat.input.newline_shortcut',
    'quick_assistant.input.toolbar.pinned_tools'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<QuickAssistantApp />)
