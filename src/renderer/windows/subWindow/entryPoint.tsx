import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { initI18n } from '@renderer/i18n'
import { createRoot } from 'react-dom/client'

import SubWindowApp from './SubWindowApp'

await initI18n()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SubWindowApp />)
