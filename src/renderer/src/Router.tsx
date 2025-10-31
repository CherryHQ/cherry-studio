import '@renderer/databases'

import { Spinner } from '@heroui/react'
import { FC, lazy, Suspense, useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import TabsContainer from './components/Tab/TabContainer'
import NavigationHandler from './handler/NavigationHandler'
import { useNavbarPosition } from './hooks/useSettings'

const HomePage = lazy(() => import('./pages/home/HomePage'))
const AssistantPresetsPage = lazy(() => import('./pages/store/assistants/presets/AssistantPresetsPage'))
const PaintingsRoutePage = lazy(() => import('./pages/paintings/PaintingsRoutePage'))
const TranslatePage = lazy(() => import('./pages/translate/TranslatePage'))
const FilesPage = lazy(() => import('./pages/files/FilesPage'))
const NotesPage = lazy(() => import('./pages/notes/NotesPage'))
const KnowledgePage = lazy(() => import('./pages/knowledge/KnowledgePage'))
const MinAppPage = lazy(() => import('./pages/minapps/MinAppPage'))
const MinAppsPage = lazy(() => import('./pages/minapps/MinAppsPage'))
const CodeToolsPage = lazy(() => import('./pages/code/CodeToolsPage'))
const SettingsPage = lazy(() => import('./pages/settings/SettingsPage'))
const LaunchpadPage = lazy(() => import('./pages/launchpad/LaunchpadPage'))

const RouterFallback: FC = () => (
  <div className="flex h-full w-full items-center justify-center">
    <Spinner color="primary" size="lg" label="Loading" />
  </div>
)

const Router: FC = () => {
  const { navbarPosition } = useNavbarPosition()

  const routes = useMemo(() => {
    return (
      <ErrorBoundary>
        <Suspense fallback={<RouterFallback />}>
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
        </Suspense>
      </ErrorBoundary>
    )
  }, [])

  if (navbarPosition === 'left') {
    return (
      <HashRouter>
        <Sidebar />
        {routes}
        <NavigationHandler />
      </HashRouter>
    )
  }

  return (
    <HashRouter>
      <NavigationHandler />
      <TabsContainer>{routes}</TabsContainer>
    </HashRouter>
  )
}

export default Router
