import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import storeSyncService from '@renderer/services/StoreSyncService'
import { createRoot } from 'react-dom/client'

import MiniWindowApp from './MiniWindowApp'

loggerService.initWindowSource('MiniWindow')

//subscribe to store sync
storeSyncService.subscribe()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MiniWindowApp />)
