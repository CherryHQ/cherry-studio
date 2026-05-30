import '@renderer/databases'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { AppShell } from '@renderer/components/layout/AppShell'
import TopViewContainer from '@renderer/components/TopView'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { NotificationProvider } from '@renderer/context/NotificationProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { TabsProvider } from '@renderer/context/TabsContext'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import store, { persistor } from '@renderer/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

const logger = loggerService.withContext('MainApp')

void preferenceService.preloadAll()

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function MainApp(): React.ReactElement {
  logger.info('MainApp initialized')

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
                        <AppShell />
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

export default MainApp
