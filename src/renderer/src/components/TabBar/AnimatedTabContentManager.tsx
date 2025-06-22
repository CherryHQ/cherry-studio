import WebviewContainer from '@renderer/components/MinApp/WebviewContainer'
import { useMinappPopup } from '@renderer/hooks/useMinappPopup'
import { useAppSelector } from '@renderer/store'
import { WebviewTag } from 'electron'
import { AnimatePresence, motion } from 'framer-motion'
import React, { lazy, Suspense, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import styled from 'styled-components'

// Lazy load page components
const HomePage = lazy(() => import('@renderer/pages/home/HomePage'))
const AgentsPage = lazy(() => import('@renderer/pages/agents/AgentsPage'))
const PaintingsRoutePage = lazy(() => import('@renderer/pages/paintings/PaintingsRoutePage'))
const TranslatePage = lazy(() => import('@renderer/pages/translate/TranslatePage'))
const FilesPage = lazy(() => import('@renderer/pages/files/FilesPage'))
const KnowledgePage = lazy(() => import('@renderer/pages/knowledge/KnowledgePage'))
const AppsPage = lazy(() => import('@renderer/pages/apps/AppsPage'))
const SettingsPage = lazy(() => import('@renderer/pages/settings/SettingsPage'))

const AnimatedTabContentManager: React.FC = () => {
  const { tabs, activeTabId } = useAppSelector((state) => state.tabs)
  const { minappShow } = useAppSelector((state) => state.runtime)
  const navigate = useNavigate()
  const webviewRefs = useRef<Map<string, WebviewTag | null>>(new Map())
  const { hideMinappPopup } = useMinappPopup()

  // Sync React Router with active tab
  useEffect(() => {
    const activeTab = tabs.find((tab) => tab.id === activeTabId)
    if (activeTab && activeTab.type === 'page' && activeTab.route) {
      // Hide minapp popup when switching to a page tab
      if (minappShow) {
        hideMinappPopup()
      }
      navigate(activeTab.route)
    }
  }, [activeTabId, tabs, navigate, minappShow, hideMinappPopup])

  // Clean up webview refs when tabs are closed
  useEffect(() => {
    const tabIds = new Set(tabs.filter((t) => t.type === 'minapp').map((t) => t.id))
    const currentRefs = Array.from(webviewRefs.current.keys())

    currentRefs.forEach((id) => {
      if (!tabIds.has(id)) {
        webviewRefs.current.delete(id)
      }
    })
  }, [tabs])

  const renderTabContent = (tab: (typeof tabs)[0]) => {
    if (tab.type === 'minapp' && tab.minapp) {
      return (
        <WebviewWrapper key={tab.instanceId} isActive={tab.isActive}>
          <WebviewContainer
            appid={`tab-${tab.id}`}
            url={tab.minapp.url}
            onSetRefCallback={(_, ref) => {
              if (ref) {
                webviewRefs.current.set(tab.id, ref)
              } else {
                webviewRefs.current.delete(tab.id)
              }
            }}
            onLoadedCallback={() => {
              // Tab-specific loaded callback if needed
            }}
            onNavigateCallback={() => {
              // Update tab title based on navigation if needed
            }}
          />
        </WebviewWrapper>
      )
    }

    // Route-based page rendering
    const PageComponent = getPageComponent(tab.route || '/')

    return (
      <PageWrapper key={tab.instanceId} isActive={tab.isActive}>
        <Suspense fallback={<LoadingView />}>
          <PageComponent />
        </Suspense>
      </PageWrapper>
    )
  }

  // Get the appropriate page component based on route
  const getPageComponent = (route: string) => {
    if (route.startsWith('/agents')) return AgentsPage
    if (route.startsWith('/paintings')) return PaintingsRoutePage
    if (route.startsWith('/translate')) return TranslatePage
    if (route.startsWith('/files')) return FilesPage
    if (route.startsWith('/knowledge')) return KnowledgePage
    if (route.startsWith('/apps')) return AppsPage
    if (route.startsWith('/settings')) return SettingsPage
    return HomePage
  }

  const activeTab = tabs.find((tab) => tab.id === activeTabId)

  return (
    <Container>
      <AnimatePresence mode="wait" initial={false}>
        {activeTab && (
          <motion.div
            key={activeTab.id}
            initial={{ opacity: 0, x: 20 }}
            animate={{
              opacity: 1,
              x: 0,
              transition: {
                duration: 0.2,
                ease: 'easeOut'
              }
            }}
            exit={{
              opacity: 0,
              x: -20,
              transition: {
                duration: 0.15,
                ease: 'easeIn'
              }
            }}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              display: 'flex',
              flexDirection: 'column'
            }}>
            {renderTabContent(activeTab)}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Keep all tabs rendered but hidden for performance */}
      {tabs.map((tab) => {
        if (tab.id === activeTabId) return null

        return (
          <HiddenTabContent key={tab.id}>
            {tab.type === 'minapp' && tab.minapp && (
              <WebviewContainer
                appid={`tab-${tab.id}`}
                url={tab.minapp.url}
                onSetRefCallback={(_, ref) => {
                  if (ref) {
                    webviewRefs.current.set(tab.id, ref)
                  } else {
                    webviewRefs.current.delete(tab.id)
                  }
                }}
                onLoadedCallback={() => {}}
                onNavigateCallback={() => {}}
              />
            )}
          </HiddenTabContent>
        )
      })}
    </Container>
  )
}

const Container = styled.div`
  flex: 1;
  display: flex;
  position: relative;
  overflow: hidden;
  background: var(--color-background);
`

const PageWrapper = styled.div<{ isActive: boolean }>`
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
`

const WebviewWrapper = styled.div<{ isActive: boolean }>`
  flex: 1;
  display: flex;
  position: relative;

  webview {
    width: 100%;
    height: 100%;
  }
`

const HiddenTabContent = styled.div`
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  visibility: hidden;
  pointer-events: none;
`

const LoadingView = styled.div`
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-2);
  font-size: 14px;

  &::before {
    content: '';
    width: 40px;
    height: 40px;
    border: 3px solid var(--color-border);
    border-top-color: var(--color-primary);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
    margin-right: 12px;
  }

  @keyframes spin {
    to {
      transform: rotate(360deg);
    }
  }
`

export default AnimatedTabContentManager
