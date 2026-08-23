import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import ConversationIslandApp from './ConversationIslandApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'ui.theme_user.font_family',
    'ui.theme_user.code_font_family'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<ConversationIslandApp />)
