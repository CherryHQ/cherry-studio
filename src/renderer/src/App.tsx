import '@renderer/databases'

import store, { persistor } from '@renderer/store'
import { Provider } from 'react-redux'
import { HashRouter, Route, Routes } from 'react-router-dom'
import { PersistGate } from 'redux-persist/integration/react'

import Sidebar from './components/app/Sidebar'
import TopViewContainer from './components/TopView'
import AntdProvider from './context/AntdProvider'
import { ThemeProvider } from './context/ThemeProvider'
import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HistoryPage from './pages/history/HistoryPage'
import HomePage from './pages/home/HomePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

function App(): JSX.Element {
  return (
    <Provider store={store}>
      <ThemeProvider>
        <AntdProvider>
          <PersistGate loading={null} persistor={persistor}>
            <TopViewContainer>
              <HashRouter>
                <Sidebar />
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/files" element={<FilesPage />} />
                  <Route path="/agents" element={<AgentsPage />} />
                  <Route path="/translate" element={<TranslatePage />} />
                  <Route path="/apps" element={<AppsPage />} />
                  <Route path="/messages/*" element={<HistoryPage />} />
                  <Route path="/settings/*" element={<SettingsPage />} />
                </Routes>
              </HashRouter>
            </TopViewContainer>
          </PersistGate>
        </AntdProvider>
      </ThemeProvider>
    </Provider>
  )
}

export default App
