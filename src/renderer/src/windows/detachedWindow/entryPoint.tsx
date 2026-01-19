import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'
import '@renderer/databases'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import { DetachedAppShell } from '@renderer/windows/detachedWindow/AppShell'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import TopViewContainer from '../../components/TopView'
import AntdProvider from '../../context/AntdProvider'
import { CodeStyleProvider } from '../../context/CodeStyleProvider'
import { NotificationProvider } from '../../context/NotificationProvider'
import StyleSheetManager from '../../context/StyleSheetManager'
import { TabsProvider } from '../../context/TabsContext'
import { ThemeProvider } from '../../context/ThemeProvider'

// Initialize logger for this window
loggerService.initWindowSource('DetachedTab')

preferenceService.preloadAll()

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

function DetachedTabApp(): React.ReactElement {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <StyleSheetManager>
          <ThemeProvider>
            <AntdProvider>
              <NotificationProvider>
                <CodeStyleProvider>
                  <PersistGate loading={null} persistor={persistor}>
                    <TabsProvider>
                      <TopViewContainer>
                        <DetachedAppShell />
                      </TopViewContainer>
                    </TabsProvider>
                  </PersistGate>
                </CodeStyleProvider>
              </NotificationProvider>
            </AntdProvider>
          </ThemeProvider>
        </StyleSheetManager>
      </QueryClientProvider>
    </Provider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<DetachedTabApp />)
