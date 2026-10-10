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
    'ui.window_style',
    'feature.quick_assistant.assistant_id',
    'feature.quick_assistant.model_id',
    // useTemporaryTopic reads the cap through a ref at lease time (not reactive), so the first
    // topic must already see the saved value here or it silently falls back to the global chain.
    'feature.quick_assistant.context_max_messages',
    'chat.default_model_id',
    'feature.quick_assistant.read_clipboard_at_startup'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<QuickAssistantApp />)
