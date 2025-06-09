import { Route, Routes, useLocation } from 'react-router-dom'

import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import McpServersPage from './pages/mcp-servers'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

const RouteContainer = () => {
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  return (
    <div style={{ display: 'flex', width: '100%', height: '100%' }}>
      <div style={{ display: isHomePage ? 'flex' : 'none', flex: 1 }}>
        <HomePage />
      </div>
      <div style={{ display: isHomePage ? 'none' : 'flex', flex: 1 }}>
        <Routes location={location}>
          <Route path="/agents" element={<AgentsPage />} />
          <Route path="/paintings/*" element={<PaintingsRoutePage />} />
          <Route path="/translate" element={<TranslatePage />} />
          <Route path="/files" element={<FilesPage />} />
          <Route path="/knowledge" element={<KnowledgePage />} />
          <Route path="/apps" element={<AppsPage />} />
          <Route path="/mcp-servers/*" element={<McpServersPage />} />
          <Route path="/settings/*" element={<SettingsPage />} />
        </Routes>
      </div>
    </div>
  )
}

export default RouteContainer
