import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'

import TabsContainer from './components/Tabs/TabsContainer'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import NavigationHandler from './handler/NavigationHandler'
import Routes from './Routes'

function App(): React.ReactElement {
  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider>
          <AntdProvider>
            <NotificationProvider>
              <CodeStyleProvider>
                <PersistGate loading={null} persistor={persistor}>
                  <TopViewContainer>
                    <HashRouter>
                      <NavigationHandler />
                      <TabsContainer>
                        <Routes />
                      </TabsContainer>
                    </HashRouter>
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
