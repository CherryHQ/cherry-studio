import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import SelectionToolbarApp from './SelectionToolbarApp'

await prepareWindow({
  preference: [
    'app.language',
    'ui.custom_css_v2',
    'ui.theme_mode',
    'ui.theme_user.color_primary',
    'feature.selection.compact',
    'feature.selection.action_items'
  ]
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionToolbarApp />)
