import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'

import { prepareWindow } from '@renderer/windows/prepareWindow'
import { createRoot } from 'react-dom/client'

import MainApp from './MainApp'

await prepareWindow({ preference: 'all' })

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MainApp />)
