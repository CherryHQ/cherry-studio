import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import { createRoot } from 'react-dom/client'

import { prepareWindow } from '@renderer/windows/prepareWindow'

import SelectionAgentApp from './SelectionAgentApp'

await prepareWindow({ preference: 'all' })

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SelectionAgentApp />)
