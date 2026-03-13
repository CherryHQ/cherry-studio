import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { WEB_SEARCH_SETTINGS_PREFERENCE_KEYS } from '@renderer/config/webSearch/setting'
import storeSyncService from '@renderer/services/StoreSyncService'
import { createRoot } from 'react-dom/client'

import MiniWindowApp from './MiniWindowApp'

loggerService.initWindowSource('MiniWindow')

await preferenceService.preload(WEB_SEARCH_SETTINGS_PREFERENCE_KEYS)

//subscribe to store sync
storeSyncService.subscribe()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MiniWindowApp />)
