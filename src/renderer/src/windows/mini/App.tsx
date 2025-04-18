import '@renderer/databases'

import { useSettings } from '@renderer/hooks/useSettings'
import store, { persistor, useAppDispatch } from '@renderer/store'
import { message } from 'antd'
import { setCustomCss } from '@renderer/store/settings'
import { useEffect, useState } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { SyntaxHighlighterProvider } from '../../context/SyntaxHighlighterProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

function useMiniWindowCustomCss() {
  const { customCss } = useSettings()
  const dispatch = useAppDispatch()
  const [isInitialized, setIsInitialized] = useState(false)

  useEffect(() => {
    // 初始化时从主进程获取最新的CSS配置
    window.api.config.get('customCss').then((css) => {
      if (css !== undefined) {
        dispatch(setCustomCss(css))
      }
      setIsInitialized(true)
    })

    // Listen for custom CSS updates from main window
    const removeListener = window.electron.ipcRenderer.on('custom-css:update', (_event, css) => {
      dispatch(setCustomCss(css))
    })

    return () => {
      removeListener()
    }
  }, [dispatch])

  useEffect(() => {
    if (!isInitialized) return

    // Apply custom CSS
    const oldCustomCss = document.getElementById('user-defined-custom-css')
    if (oldCustomCss) {
      oldCustomCss.remove()
    }

    if (customCss) {
      const style = document.createElement('style')
      style.id = 'user-defined-custom-css'
      style.textContent = customCss
      document.head.appendChild(style)
    }
  }, [customCss, isInitialized])

  return isInitialized
}

function MiniWindow(): React.ReactElement {
  //miniWindow should register its own message component
  const [messageApi, messageContextHolder] = message.useMessage()
  window.message = messageApi

  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <SyntaxHighlighterProvider>
            <PersistGate loading={null} persistor={persistor}>
              {messageContextHolder}
              <MiniWindowContent />
            </PersistGate>
          </SyntaxHighlighterProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

// Inner component that uses the hook after Redux is initialized
function MiniWindowContent(): React.ReactElement {
  const cssInitialized = useMiniWindowCustomCss()

  // Show empty fragment until CSS is initialized
  if (!cssInitialized) {
    return <></>
  }

  return <HomeWindow />
}

export default MiniWindow
