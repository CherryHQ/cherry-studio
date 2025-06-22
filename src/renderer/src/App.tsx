import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'
import styled from 'styled-components'

import Sidebar from './components/app/Sidebar'
import { TabBar, TabContentManager } from './components/TabBar'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import NavigationHandler from './handler/NavigationHandler'
import { useTabShortcuts } from './hooks/useTabShortcuts'

function AppContent(): React.ReactElement {
  // Initialize tab shortcuts
  useTabShortcuts()

  return (
    <TopViewContainer>
      <HashRouter>
        <NavigationHandler />
        <AppLayout>
          <Sidebar />
          <MainContent>
            <TabBar />
            <ContentArea>
              <TabContentManager />
            </ContentArea>
          </MainContent>
        </AppLayout>
      </HashRouter>
    </TopViewContainer>
  )
}

function App(): React.ReactElement {
  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider>
          <AntdProvider>
            <NotificationProvider>
              <CodeStyleProvider>
                <PersistGate loading={null} persistor={persistor}>
                  <AppContent />
                </PersistGate>
              </CodeStyleProvider>
            </NotificationProvider>
          </AntdProvider>
        </ThemeProvider>
      </StyleSheetManager>
    </Provider>
  )
}

const AppLayout = styled.div`
  display: flex;
  height: 100vh;
  width: 100vw;
  overflow: hidden;
`

const MainContent = styled.div`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const ContentArea = styled.div`
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
`

export default App
