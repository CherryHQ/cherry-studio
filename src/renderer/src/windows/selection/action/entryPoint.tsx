import '@renderer/assets/styles/index.scss'
import '@ant-design/v5-patch-for-react-19'

import { preferenceService } from '@data/PreferenceService'
import KeyvStorage from '@kangfenmao/keyv-storage'
import { loggerService } from '@logger'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import storeSyncService from '@renderer/services/StoreSyncService'
import store, { persistor } from '@renderer/store'
import { message } from 'antd'
import { FC } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import SelectionActionApp from './SelectionActionApp'

loggerService.initWindowSource('SelectionActionWindow')

await preferenceService.preload([
  'app.language',
  'ui.custom_css',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'feature.selection.auto_close',
  'feature.selection.auto_pin',
  'feature.selection.action_window_opacity'
])

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
  const [messageApi, messageContextHolder] = message.useMessage()
  window.message = messageApi

  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <CodeStyleProvider>
            <PersistGate loading={null} persistor={persistor}>
              {messageContextHolder}
              <SelectionActionApp />
            </PersistGate>
          </CodeStyleProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
