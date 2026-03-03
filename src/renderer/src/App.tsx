import '@renderer/databases'

import { loggerService } from '@logger'
import store, { persistor } from '@renderer/store'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
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
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function App(): React.ReactElement {
  logger.info('App initialized')

  // 监听主进程的日志输出
  useEffect(() => {
    const handler = (
      _event: Electron.IpcRendererEvent,
      data: { level: string; message: string } | { message: string; data?: any }
    ) => {
      // Handle new format with level
      if ('level' in data) {
        const prefix = `[Main Process ${data.level.toUpperCase()}]`
        const logMethod = data.level === 'error' ? console.error : data.level === 'warn' ? console.warn : console.log
        logMethod(prefix, data.message)
      } else {
        // Handle old format
        console.log(`[Main Process] ${data.message}`, data.data || '')
      }
    }

    // @ts-ignore - custom event
    window.electron?.ipcRenderer?.on('console-log', handler)

    return () => {
      // @ts-ignore - custom event
      window.electron?.ipcRenderer?.removeListener('console-log', handler)
    }
  }, [])

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
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
      </QueryClientProvider>
    </Provider>
  )
}

export default App
