import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { createRoot } from 'react-dom/client'

import MainApp from './MainApp'

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MainApp />)
