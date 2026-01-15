/**
 * Popup Entry Point
 *
 * Quick actions popup for Cherry Studio extension.
 * Provides fast access to common features.
 */

import React, { useState, useEffect } from 'react'
import { createRoot } from 'react-dom/client'

// Simple styles (avoiding full Ant Design for popup performance)
const styles = {
  container: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '12px'
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    marginBottom: '8px'
  },
  logo: {
    width: '32px',
    height: '32px',
    borderRadius: '8px'
  },
  title: {
    fontSize: '16px',
    fontWeight: 600
  },
  input: {
    width: '100%',
    padding: '10px 12px',
    fontSize: '14px',
    border: '1px solid #ddd',
    borderRadius: '8px',
    outline: 'none'
  },
  button: {
    width: '100%',
    padding: '10px 16px',
    fontSize: '14px',
    fontWeight: 500,
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    transition: 'all 0.2s ease'
  },
  primaryButton: {
    background: '#7c3aed',
    color: 'white'
  },
  secondaryButton: {
    background: '#f3f4f6',
    color: '#374151'
  },
  footer: {
    marginTop: '8px',
    paddingTop: '12px',
    borderTop: '1px solid #eee',
    fontSize: '12px',
    color: '#888',
    textAlign: 'center' as const
  }
}

// Dark mode styles
const darkStyles = {
  input: {
    ...styles.input,
    background: '#2d2d2d',
    border: '1px solid #404040',
    color: '#e5e5e5'
  },
  secondaryButton: {
    ...styles.secondaryButton,
    background: '#2d2d2d',
    color: '#e5e5e5'
  },
  footer: {
    ...styles.footer,
    borderTop: '1px solid #333'
  }
}

function Popup() {
  const [quickInput, setQuickInput] = useState('')
  const [isDark, setIsDark] = useState(false)

  useEffect(() => {
    // Check system dark mode
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    setIsDark(mediaQuery.matches)
    const handler = (e: MediaQueryListEvent) => setIsDark(e.matches)
    mediaQuery.addEventListener('change', handler)
    return () => mediaQuery.removeEventListener('change', handler)
  }, [])

  const openSidePanel = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
    }
    window.close()
  }

  const askWithSelection = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'getSelection' }, async (selection) => {
        if (selection) {
          await chrome.storage.session.set({
            pendingAction: { type: 'ask', text: selection }
          })
          chrome.sidePanel.open({ tabId: tab.id! })
          window.close()
        }
      })
    }
  }

  const quickAsk = async () => {
    if (!quickInput.trim()) return
    await chrome.storage.session.set({
      pendingAction: { type: 'ask', text: quickInput }
    })
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.sidePanel.open({ tabId: tab.id })
    }
    window.close()
  }

  const openSettings = () => {
    chrome.runtime.openOptionsPage()
    window.close()
  }

  const s = isDark ? { ...styles, ...darkStyles } : styles

  return (
    <div style={s.container}>
      <div style={s.header}>
        <img src="./icons/icon48.png" alt="Cherry Studio" style={s.logo} />
        <span style={s.title}>Cherry Studio</span>
      </div>

      <input
        type="text"
        placeholder="Quick ask..."
        value={quickInput}
        onChange={(e) => setQuickInput(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && quickAsk()}
        style={s.input}
        autoFocus
      />

      <button
        onClick={quickAsk}
        style={{ ...s.button, ...s.primaryButton }}
        disabled={!quickInput.trim()}
      >
        <span>Ask AI</span>
      </button>

      <button onClick={openSidePanel} style={{ ...s.button, ...s.secondaryButton }}>
        <span>Open Chat Panel</span>
      </button>

      <button onClick={askWithSelection} style={{ ...s.button, ...s.secondaryButton }}>
        <span>Ask About Selection</span>
      </button>

      <button onClick={openSettings} style={{ ...s.button, ...s.secondaryButton }}>
        <span>Settings</span>
      </button>

      <div style={s.footer}>
        Press <kbd>Ctrl+Shift+S</kbd> to open panel
      </div>
    </div>
  )
}

// Mount the app
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<Popup />)
}
