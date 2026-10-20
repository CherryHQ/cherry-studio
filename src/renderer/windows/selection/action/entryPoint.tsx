import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { prepareWindow } from '@renderer/windows/prepareWindow'

import SelectionActionApp from './SelectionActionApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'feature.selection.auto_close',
    'feature.selection.auto_pin',
    'feature.selection.action_window_opacity',
    'feature.quick_assistant.assistant_id',
    'feature.translate.action.alter_lang',
    'feature.translate.action.preferred_lang',
    'feature.voice.dictation.hold_shortcut',
    'feature.voice.dictation.toggle_shortcut'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionActionApp />)
