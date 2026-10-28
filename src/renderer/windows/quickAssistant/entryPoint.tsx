import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { prepareWindow } from '@renderer/windows/prepareWindow'

import QuickAssistantApp from './QuickAssistantApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'feature.quick_assistant.assistant_id',
    'chat.default_model_id',
    'chat.input.send_message_shortcut',
    'chat.input.newline_shortcut',
    'quick_assistant.input.toolbar.pinned_tools',
    'feature.voice.dictation.hold_shortcut',
    'feature.voice.dictation.mouse_hold_enabled',
    'feature.voice.dictation.toggle_shortcut'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<QuickAssistantApp />)
