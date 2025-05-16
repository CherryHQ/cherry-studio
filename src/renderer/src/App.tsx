import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'

import Sidebar from './components/app/Sidebar'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { CodeStyleProvider } from './context/CodeStyleProvider'
import StyleSheetManager from './context/StyleSheetManager'
import { ThemeProvider } from './context/ThemeProvider'
import NavigationHandler from './handler/NavigationHandler'
import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

function App(): React.ReactElement {
  return (
    <Provider store={store}>
      <StyleSheetManager>
        <ThemeProvider>
          <AntdProvider>
            <CodeStyleProvider>
              <PersistGate loading={null} persistor={persistor}>
                <TopViewContainer>
                  <HashRouter>
                    <NavigationHandler />
                    <Sidebar />
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/agents" element={<AgentsPage />} />
                      <Route path="/paintings/*" element={<PaintingsRoutePage />} />
                      <Route path="/translate" element={<TranslatePage />} />
                      <Route path="/files" element={<FilesPage />} />
                      <Route path="/knowledge" element={<KnowledgePage />} />
                      <Route path="/apps" element={<AppsPage />} />
                      <Route path="/settings/*" element={<SettingsPage />} />
                    </Routes>
                  </HashRouter>
                </TopViewContainer>
              </PersistGate>
            </CodeStyleProvider>
          </AntdProvider>
        </ThemeProvider>
      </StyleSheetManager>
    </Provider>
  )
}

export default App
