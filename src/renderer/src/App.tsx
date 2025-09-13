import '@renderer/databases'

import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import { ToastPortal } from './components/ToastPortal'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { HeroUIProvider } from './context/HeroUIProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import Router from './Router'

const logger = loggerService.withContext('App.tsx')

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function App(): React.ReactElement {
  logger.info('App initialized')

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <HeroUIProvider>
          <StyleSheetManager>
            <ThemeProvider>
              <AntdProvider>
                <NotificationProvider>
                  <CodeStyleProvider>
                    <PersistGate loading={null} persistor={persistor}>
                      <TopViewContainer>
                        <Router />
                      </TopViewContainer>
                    </PersistGate>
                  </CodeStyleProvider>
                </NotificationProvider>
              </AntdProvider>
            </ThemeProvider>
          </StyleSheetManager>
          <ToastPortal />
        </HeroUIProvider>
      </QueryClientProvider>
    </Provider>
  )
}

export default App
