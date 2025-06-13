import { IpcChannel } from '@shared/IpcChannel'
import { AnimatePresence, motion } from 'framer-motion'
import { useEffect } from 'react'
import { Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import styled from 'styled-components'

import AgentsPage from './pages/agents/AgentsPage'
import AppsPage from './pages/apps/AppsPage'
import FilesPage from './pages/files/FilesPage'
import HomePage from './pages/home/HomePage'
import KnowledgePage from './pages/knowledge/KnowledgePage'
import McpServersPage from './pages/mcp-servers'
import PaintingsRoutePage from './pages/paintings/PaintingsRoutePage'
import SettingsPage from './pages/settings/SettingsPage'
import TranslatePage from './pages/translate/TranslatePage'

const WILDCARD_ROUTES = ['/settings', '/paintings', '/mcp-servers']

const RouteContainer = () => {
  const navigate = useNavigate()
  const location = useLocation()
  const isHomePage = location.pathname === '/'

  // 获取当前路径的主路由部分
  const mainPath = WILDCARD_ROUTES.find((route) => location.pathname.startsWith(route))

  // 使用主路由作为 key，这样同一主路由下的切换不会触发动画
  const animationKey = mainPath || location.pathname

  useEffect(() => {
    window.api.navigation.url(location.pathname)
  }, [location.pathname])

  useEffect(() => {
    window.electron.ipcRenderer.on(IpcChannel.Navigation_Close, () => navigate('/'))
  }, [navigate])

  return (
    <Container>
      <HomePageWrapper />
      <AnimatePresence mode="wait">
        {!isHomePage && (
          <PageContainer
            key={animationKey}
            initial="initial"
            animate="animate"
            exit="exit"
            variants={pageVariants}
            transition={pageTransition}>
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
          </PageContainer>
        )}
      </AnimatePresence>
    </Container>
  )
}

const Container = styled.div`
  position: relative;
  width: 100%;
  height: 100%;
  min-width: 0;
  overflow: hidden;
`

const HomePageWrapper = styled(HomePage)`
  display: flex;
  width: 100%;
  height: 100%;
`

const PageContainer = styled(motion.div)`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  background: var(--color-base);
  display: flex;
  width: 100%;
  height: 100%;
  z-index: 10;
  will-change: transform;
  backface-visibility: hidden;
`

const pageTransition = {
  type: 'tween',
  duration: 0.25,
  ease: [0.4, 0.0, 0.2, 1]
}

const pageVariants = {
  initial: { translateY: '100%' },
  animate: { translateY: '0%' },
  exit: { translateY: '100%' }
}

export default RouteContainer
