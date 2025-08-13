import '@renderer/databases'

import { FC, useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'

import Sidebar from './components/app/Sidebar'
import TabsContainer from './components/Tab/TabContainer'
import NavigationHandler from './handler/NavigationHandler'
import { useNavbarPosition } from './hooks/useSettings'
import AgentsPage from './pages/agents/AgentsPage'
import CodeToolsPage from './pages/code/CodeToolsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import LaunchpadPage from './pages/launchpad/LaunchpadPage'
import MinAppsPage from './pages/minapps/MinAppsPage'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'
import { AppRoutes } from './types'

const Router: FC = () => {
  const { navbarPosition } = useNavbarPosition()

  const routes = useMemo(() => {
    return (
      <Routes>
        <Route path={AppRoutes.HOME} element={<HomePage />} />
        <Route path={AppRoutes.AGENTS} element={<AgentsPage />} />
        <Route path={AppRoutes.PAINTINGS_ROOT} element={<PaintingsRoutePage />} />
        <Route path={AppRoutes.TRANSLATE} element={<TranslatePage />} />
        <Route path={AppRoutes.FILES} element={<FilesPage />} />
        <Route path={AppRoutes.KNOWLEDGE} element={<KnowledgePage />} />
        <Route path={AppRoutes.APPS} element={<MinAppsPage />} />
        <Route path={AppRoutes.CODE} element={<CodeToolsPage />} />
        <Route path={AppRoutes.SETTINGS_ROOT} element={<SettingsPage />} />
        <Route path={AppRoutes.LAUNCHPAD} element={<LaunchpadPage />} />
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
