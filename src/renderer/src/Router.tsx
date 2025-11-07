import '@renderer/databases'

import { FC, useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import SideMenu from './components/app/SideMenu'
import { ErrorBoundary } from './components/ErrorBoundary'
import NavigationHandler from './handler/NavigationHandler'
import { useShowSideMenu } from './hooks/useStore'
import CodeToolsPage from './pages/code/CodeToolsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import LaunchpadPage from './pages/launchpad/LaunchpadPage'
import MinAppPage from './pages/minapps/MinAppPage'
import MinAppsPage from './pages/minapps/MinAppsPage'
import NotesPage from './pages/notes/NotesPage'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import AssistantPresetsPage from './pages/store/assistants/presets/AssistantPresetsPage'
import TranslatePage from './pages/translate/TranslatePage'

const RouterContent: FC = () => {
  const { showSideMenu } = useShowSideMenu()
  
  const routes = useMemo(() => {
    return (
      <ErrorBoundary>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/store" element={<AssistantPresetsPage />} />
          <Route path="/paintings/*" element={<PaintingsRoutePage />} />
          <Route path="/translate" element={<TranslatePage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/notes" element={<NotesPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/apps/:appId" element={<MinAppPage />} />
          <Route path="/apps" element={<MinAppsPage />} />
          <Route path="/code" element={<CodeToolsPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
          <Route path="/launchpad" element={<LaunchpadPage />} />
        </Routes>
      </ErrorBoundary>
    )
  }, [])

  return (
    <>
      {showSideMenu && <SideMenu />}
      {routes}
      <NavigationHandler />
    </>
  )
}

const Router: FC = () => {
  return (
    <HashRouter>
      <RouterContent />
    </HashRouter>
  )
}

export default Router
