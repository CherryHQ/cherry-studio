import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'

import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'
import { ToastPortal } from '@renderer/components/ToastPortal'
import { getToastUtilities } from '@renderer/components/TopView/toast'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { HeroUIProvider } from '@renderer/context/HeroUIProvider'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import storeSyncService from '@renderer/services/StoreSyncService'
import store, { persistor } from '@renderer/store'
import { FC, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import SelectionActionApp from './SelectionActionApp'

loggerService.initWindowSource('SelectionActionWindow')

/**
 * fetchChatCompletion depends on this,
 * which is not a good design, but we have to add it for now
 */
function initKeyv() {
  window.keyv = new KeyvStorage()
  window.keyv.init()
}

initKeyv()

//subscribe to store sync
storeSyncService.subscribe()

const App: FC = () => {
  //actionWindow should register its own message component
  useEffect(() => {
    window.toast = getToastUtilities()
  }, [])

  return (
    <Provider store={store}>
      <HeroUIProvider>
        <ThemeProvider>
          <AntdProvider>
            <CodeStyleProvider>
              <PersistGate loading={null} persistor={persistor}>
                <SelectionActionApp />
              </PersistGate>
            </CodeStyleProvider>
          </AntdProvider>
        </ThemeProvider>
        <ToastPortal />
      </HeroUIProvider>
    </Provider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
