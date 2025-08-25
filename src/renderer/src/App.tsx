import '@renderer/databases'

import { loggerService } from '@logger'
import MemoryCleanupService from '@renderer/services/MemoryCleanupService'
import store, { persistor } from '@renderer/store'
import { cleanupAllThrottledUpdates } from '@renderer/store/thunk/messageThunk'
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

function App(): React.ReactElement {
  logger.info('App initialized')

  // 应用关闭时清理资源 - 多重保障
  const cleanup = () => {
    // 清理所有节流器和RAF回调
    cleanupAllThrottledUpdates()
    // 清理内存服务
    MemoryCleanupService.destroy()
  }

  // 多种事件监听确保清理执行
  window.addEventListener('beforeunload', cleanup)
  window.addEventListener('unload', cleanup)
  window.addEventListener('pagehide', cleanup)

  // 如果是 Electron 环境，也监听主进程的关闭事件
  if (window.electron) {
    window.electron.ipcRenderer.on('app-will-quit', cleanup)
  }

  return (
    <Provider store={store}>
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
    </Provider>
  )
}

export default App
