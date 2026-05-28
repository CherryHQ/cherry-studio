import '@renderer/databases'

import { loggerService } from '@logger'
import type { RootState } from '@renderer/store'
import store, { persistor } from '@renderer/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ConfigProvider } from 'antd'
import { useEffect } from 'react'
import { Provider, useSelector } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import Router from './Router'

const logger = loggerService.withContext('App.tsx')

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

// RTL language list
const RTL_LANGS = ['ar', 'he', 'fa', 'ur']

function isRTL(lang: string): boolean {
  if (!lang) return false
  return RTL_LANGS.includes(lang.split('-')[0])
}

/**
 * Inner app that has access to Redux state
 */
function AppContent(): React.ReactElement {
  const lang = useSelector((state: RootState) => state.settings.language) ?? navigator.language ?? 'en'

  const direction = isRTL(lang) ? 'rtl' : 'ltr'

  useEffect(() => {
    document.documentElement.setAttribute('dir', direction)
    document.documentElement.setAttribute('lang', lang)
  }, [lang, direction])

  logger.info(`App initialized (lang=${lang}, dir=${direction})`)

  return (
    <ConfigProvider direction={direction}>
      {/* NOTE: removed invalid `direction` prop */}
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
    </ConfigProvider>
  )
}

/**
 * Root App wrapper
 */
function App(): React.ReactElement {
  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <AppContent />
      </QueryClientProvider>
    </Provider>
  )
}

export default App
