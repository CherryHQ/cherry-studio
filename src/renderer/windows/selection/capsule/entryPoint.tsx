import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { prepareWindow } from '@renderer/windows/prepareWindow'

import SelectionCapsuleApp from './SelectionCapsuleApp'

await prepareWindow({
  preference: ['app.language', 'ui.custom_css', 'ui.theme_mode', 'ui.theme_user.color_primary']
})

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionCapsuleApp />)
