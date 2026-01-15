/**
 * Minimal Chat Component for Chrome Extension Sidepanel
 *
 * Provides a simplified chat interface with:
 * - "Open Full App" button
 * - Simple message display
 * - Basic text input
 */

import { useCallback } from 'react'
import styled from 'styled-components'

export default function MinimalChat() {
  const openFullApp = useCallback(async () => {
    await chrome.windows.create({
      url: chrome.runtime.getURL('src/extension/window.html'),
      type: 'popup',
      width: 1200,
      height: 800,
      focused: true
    })
  }, [])

  return (
    <Container>
      <Header>
        <Title>Cherry Studio</Title>
        <OpenWindowButton onClick={openFullApp} title="Open Cherry Studio in a separate window">
          <WindowIcon>🪟</WindowIcon>
          <span>Open Full App</span>
        </OpenWindowButton>
      </Header>

      <MessagesArea>
        <WelcomeMessage>
          <h2>Welcome to Cherry Studio!</h2>
          <p>Click "Open Full App" above to access all features.</p>
          <FeatureList>
            <li>✨ Multiple AI Model Support</li>
            <li>💬 Advanced Chat Interface</li>
            <li>🎨 Customizable Themes</li>
            <li>🔧 Powerful Tools & Extensions</li>
          </FeatureList>
        </WelcomeMessage>
      </MessagesArea>
    </Container>
  )
}

const Container = styled.div`
  display: flex;
  flex-direction: column;
  height: 100vh;
  background: var(--color-background);
  color: var(--color-text);
`

const Header = styled.div`
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--color-border);
  background: var(--color-background-soft);
  gap: 12px;
`

const Title = styled.h1`
  font-size: 18px;
  font-weight: 600;
  margin: 0;
  color: var(--color-text);
`

const OpenWindowButton = styled.button`
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 16px;
  background: var(--color-primary);
  color: white;
  border: none;
  border-radius: 8px;
  cursor: pointer;
  font-size: 14px;
  font-weight: 500;
  white-space: nowrap;
  transition: all 0.2s ease;

  &:hover {
    opacity: 0.9;
    transform: translateY(-1px);
  }

  &:active {
    transform: translateY(0);
  }
`

const WindowIcon = styled.span`
  font-size: 16px;
`

const MessagesArea = styled.div`
  flex: 1;
  overflow: auto;
  padding: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
`

const WelcomeMessage = styled.div`
  text-align: center;
  max-width: 500px;

  h2 {
    font-size: 24px;
    margin-bottom: 12px;
    color: var(--color-text);
  }

  p {
    font-size: 16px;
    color: var(--color-text-secondary);
    margin-bottom: 24px;
  }
`

const FeatureList = styled.ul`
  list-style: none;
  padding: 0;
  margin: 0;
  text-align: left;

  li {
    padding: 12px;
    margin-bottom: 8px;
    background: var(--color-background-soft);
    border-radius: 8px;
    font-size: 14px;
    color: var(--color-text);
  }
`
