import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'

import MainSidebar from './components/app/MainSidebar'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import { NotificationProvider } from './context/NotificationProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import NavigationHandler from './handler/NavigationHandler'
import DiscoverPage from './pages/discover'
import HomePage from './pages/home/HomePage'
import SettingsPage from './pages/settings/SettingsPage'

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
                      <MainSidebar />
                      <Routes>
                        <Route path="/" element={<HomePage />} />
                        {/* <Route path="/agents" element={<AgentsPage />} /> */}
                        {/* <Route path="/paintings/*" element={<PaintingsRoutePage />} /> */}
                        {/* <Route path="/translate" element={<TranslatePage />} /> */}
                        {/* <Route path="/files" element={<FilesPage />} /> */}
                        {/* <Route path="/knowledge" element={<KnowledgePage />} /> */}
                        {/* <Route path="/apps" element={<AppsPage />} /> */}
                        {/* <Route path="/mcp-servers/*" element={<McpServersPage />} /> */}
                        <Route path="/settings/*" element={<SettingsPage />} />
                        <Route path="/discover/*" element={<DiscoverPage />} />
                      </Routes>
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
