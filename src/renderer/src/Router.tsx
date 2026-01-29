import '@renderer/databases'

import type { FC } from 'react'
import { useMemo } from 'react'
import { HashRouter, Route, Routes } from 'react-router-dom'
import styled from 'styled-components'

import Sidebar from './components/app/Sidebar'
import { ErrorBoundary } from './components/ErrorBoundary'
import { OnboardingProvider } from './components/Onboarding'
import TabsContainer from './components/Tab/TabContainer'
import { CompletionModal, GuidePage, useTaskCompletion, useUserGuide } from './components/UserGuide'
import NavigationHandler from './handler/NavigationHandler'
import { useNavbarPosition } from './hooks/useSettings'
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

const UserGuideComponents: FC = () => {
  // Enable task completion detection
  useTaskCompletion()

  return <CompletionModal />
}

/**
 * Main container that sets navbar-position attribute for child CSS selectors
 */
const AppContainer = styled.div`
  display: flex;
  flex-direction: row;
  height: 100vh;
  width: 100vw;
`

/**
 * Main content area for left navbar layout
 */
const MainContent = styled.div`
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
`

/**
 * Main app layout that renders after GuidePage is completed
 */
const MainAppLayout: FC = () => {
  const { navbarPosition } = useNavbarPosition()

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

  if (navbarPosition === 'left') {
    return (
      <AppContainer navbar-position="left">
        <Sidebar />
        <MainContent>{routes}</MainContent>
        <NavigationHandler />
        <UserGuideComponents />
      </AppContainer>
    )
  }

  return (
    <AppContainer navbar-position="top">
      <NavigationHandler />
      <TabsContainer>{routes}</TabsContainer>
      <UserGuideComponents />
    </AppContainer>
  )
}

/**
 * Content switcher that shows either GuidePage or MainAppLayout
 * based on user guide completion status
 */
const AppContent: FC = () => {
  const { shouldShowGuidePage } = useUserGuide()

  if (shouldShowGuidePage) {
    return <GuidePage />
  }

  return <MainAppLayout />
}

/**
 * Router component that conditionally renders GuidePage as a full-screen overlay
 * before showing the main app layout. This ensures users complete the guide page
 * before seeing any navigation elements.
 */
const Router: FC = () => {
  return (
    <HashRouter>
      <OnboardingProvider>
        <AppContent />
      </OnboardingProvider>
    </HashRouter>
  )
}

export default Router
