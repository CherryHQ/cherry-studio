import { Route, Routes } from 'react-router-dom'

import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import LaunchpadPage from './pages/launchpad/LaunchpadPage'
import McpServersPage from './pages/mcp-servers'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

const RouteContainer = () => {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/agents" element={<AgentsPage />} />
      <Route path="/paintings/*" element={<PaintingsRoutePage />} />
      <Route path="/translate" element={<TranslatePage />} />
      <Route path="/files" element={<FilesPage />} />
      <Route path="/knowledge" element={<KnowledgePage />} />
      <Route path="/apps" element={<AppsPage />} />
      <Route path="/mcp-servers/*" element={<McpServersPage />} />
      <Route path="/settings/*" element={<SettingsPage />} />
      <Route path="/launchpad" element={<LaunchpadPage />} />
    </Routes>
  )
}

export default RouteContainer
