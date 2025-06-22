import MinAppIcon from '@renderer/components/Icons/MinAppIcon'
import { Tab } from '@renderer/store/tabs'
import { AnimatePresence, motion } from 'framer-motion'
import React, { useEffect, useState } from 'react'
import styled from 'styled-components'

const PreviewContainer = styled(motion.div)`
  position: absolute;
  top: 100%;
  left: 50%;
  transform: translateX(-50%);
  margin-top: 8px;
  width: 300px;
  height: 200px;
  background: var(--color-background);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.15);
  overflow: hidden;
  z-index: 1000;
  pointer-events: none;

  &::before {
    content: '';
    position: absolute;
    top: -6px;
    left: 50%;
    transform: translateX(-50%);
    width: 12px;
    height: 12px;
    background: var(--color-background);
    border-left: 1px solid var(--color-border);
    border-top: 1px solid var(--color-border);
    transform: translateX(-50%) rotate(45deg);
  }
`

const PreviewContent = styled.div`
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
`

const PreviewPage = styled.div`
  width: 100%;
  height: 100%;
  padding: 16px;
  background: var(--color-background);
  overflow: hidden;

  h3 {
    margin: 0 0 8px 0;
    font-size: 14px;
    color: var(--color-text-primary);
  }

  p {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-secondary);
    line-height: 1.4;
  }
`

const LoadingIndicator = styled.div`
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--color-text-secondary);
  font-size: 12px;
`

interface TabPreviewProps {
  tab: Tab
  isVisible: boolean
}

export const TabPreview: React.FC<TabPreviewProps> = ({ tab, isVisible }) => {
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    if (!isVisible) {
      setIsLoading(true)
      return
    }

    const loadPreview = async () => {
      setIsLoading(true)
      // Simulate loading delay
      await new Promise((resolve) => setTimeout(resolve, 100))
      setIsLoading(false)
    }

    // Delay preview loading to avoid performance issues
    const timeout = setTimeout(loadPreview, 300)
    return () => clearTimeout(timeout)
  }, [isVisible, tab])

  const renderPreviewContent = () => {
    if (isLoading) {
      return <LoadingIndicator>Loading preview...</LoadingIndicator>
    }

    if (tab.type === 'minapp' && tab.minapp) {
      return (
        <PreviewPage>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
            <MinAppIcon size={32} app={tab.minapp} style={{ borderRadius: 8 }} />
            <div>
              <h3>{tab.minapp.name}</h3>
              <p style={{ margin: 0, fontSize: '11px', opacity: 0.7 }}>{tab.minapp.url}</p>
            </div>
          </div>
          <p>External application</p>
        </PreviewPage>
      )
    }

    if (tab.type === 'page') {
      // Show page information
      const pageDescriptions: Record<string, string> = {
        '/home': 'Chat with AI assistants and manage your conversations',
        '/apps': 'Browse and manage your installed applications',
        '/agents': 'Explore and configure AI agents',
        '/files': 'Manage your files and documents',
        '/knowledge': 'Access your knowledge base and resources',
        '/paintings': 'Create and view AI-generated images',
        '/translate': 'Translate text between languages',
        '/history': 'View your conversation history',
        '/settings': 'Configure application settings'
      }

      return (
        <PreviewPage>
          <h3>{tab.title}</h3>
          <p>{pageDescriptions[tab.route || ''] || 'View page content'}</p>
        </PreviewPage>
      )
    }

    return <LoadingIndicator>No preview available</LoadingIndicator>
  }

  return (
    <AnimatePresence>
      {isVisible && (
        <PreviewContainer
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -10 }}
          transition={{ duration: 0.15 }}>
          <PreviewContent>{renderPreviewContent()}</PreviewContent>
        </PreviewContainer>
      )}
    </AnimatePresence>
  )
}
