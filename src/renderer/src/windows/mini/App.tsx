import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { message } from 'antd'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

import AntdProvider from '../../context/AntdProvider'
import { SyntaxHighlighterProvider } from '../../context/SyntaxHighlighterProvider'
import { ThemeProvider } from '../../context/ThemeProvider'
import HomeWindow from './home/HomeWindow'

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
              <HomeWindow />
            </PersistGate>
          </SyntaxHighlighterProvider>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default MiniWindow
