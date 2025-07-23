import '@renderer/assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'
import storeSyncService from '@renderer/services/StoreSyncService'
import { createRoot } from 'react-dom/client'

import MiniWindowApp from './MiniWindowApp'

loggerService.initWindowSource('MiniWindow')

/**
 *  This function is required for model API
 *    eg. BaseProviders.ts
 *  Although the coupling is too strong, we have no choice but to load it
 *  In multi-window handling, decoupling is needed
 */
function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}
initKeyv()

//subscribe to store sync
storeSyncService.subscribe()

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<MiniWindowApp />)
