import '@renderer/databases'

import { useSettings } from '@renderer/hooks/useSettings'
import store, { persistor, useAppDispatch } from '@renderer/store'
import { setCustomCss } from '@renderer/store/settings'
import { useEffect } from 'react'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { SyntaxHighlighterProvider } from '../../context/SyntaxHighlighterProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

function useMiniWindowCustomCss() {
  const { customCss } = useSettings()
  const dispatch = useAppDispatch()

  const applyCustomCss = (css: string) => {
    const oldCustomCss = document.getElementById('user-defined-custom-css')
    if (oldCustomCss) {
      oldCustomCss.remove()
    }

    if (css) {
      const style = document.createElement('style')
      style.id = 'user-defined-custom-css'
      style.textContent = css
      document.head.appendChild(style)
    }
  }

  useEffect(() => {
    // Initial load, get the latest CSS from the config manager
    window.api.config
      .get('customCss')
      .then((latestCss) => {
        if (latestCss && latestCss !== customCss) {
          dispatch(setCustomCss(latestCss))
          applyCustomCss(latestCss)
        } else if (customCss) {
          applyCustomCss(customCss)
        }
      })
      .catch(() => {
        applyCustomCss(customCss)
      })

    // Setup listener for CSS updates
    const removeListener = window.api.customCss.onCustomCssUpdate((css) => {
      // 当收到更新时，同时更新Redux状态，确保同步
      if (css !== customCss) {
        dispatch(setCustomCss(css))
      }
      applyCustomCss(css)
    })

    return () => {
      removeListener()
    }
  }, [customCss, dispatch])
}

function MiniWindow(): React.ReactElement {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <SyntaxHighlighterProvider>
            <PersistGate loading={null} persistor={persistor}>
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
  useMiniWindowCustomCss()

  return <HomeWindow />
}

export default MiniWindow
