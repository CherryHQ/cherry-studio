import '@renderer/databases'

import { FC, useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import Sidebar from './components/app/Sidebar'
import TabsContainer from './components/Tab/TabContainer'
import NavigationHandler from './handler/NavigationHandler'
import { useNavbarPosition } from './hooks/useSettings'
import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import LaunchpadPage from './pages/launchpad/LaunchpadPage'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

const Router: FC = () => {
  const { navbarPosition } = useNavbarPosition()

  const routes = useMemo(() => {
    return (
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/agents" element={<AgentsPage />} />
        <Route path="/paintings/*" element={<PaintingsRoutePage />} />
        <Route path="/translate" element={<TranslatePage />} />
        <Route path="/files" element={<FilesPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/apps" element={<AppsPage />} />
        <Route path="/settings/*" element={<SettingsPage />} />
        <Route path="/launchpad" element={<LaunchpadPage />} />
      </Routes>
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
