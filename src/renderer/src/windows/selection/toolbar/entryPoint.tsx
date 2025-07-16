import '@ant-design/v5-patch-for-react-19'

import { loggerService } from '@logger'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import storeSyncService from '@renderer/services/StoreSyncService'
import store, { persistor } from '@renderer/store'
import { FC } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import SelectionToolbar from './SelectionToolbar'

loggerService.initWindowSource('SelectionToolbar')

//subscribe to store sync
storeSyncService.subscribe()

const App: FC = () => {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <PersistGate loading={null} persistor={persistor}>
          <SelectionToolbar />
        </PersistGate>
      </ThemeProvider>
    </Provider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<App />)
