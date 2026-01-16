/**
 * Sidepanel Entry Point
 *
 * Loads a conversation-only chat interface for the Chrome extension sidepanel.
 * Uses the same provider hierarchy as the full app but renders only MinimalChat.
 *
 * NOTE: window.api and window.electron are initialized in sidepanel.html
 * before this module loads to prevent undefined errors.
 */

// Load full shim to replace stubs with real implementations
import './shim'
// Import styles
import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
// React 19 compatibility patch for Ant Design v5
import '@ant-design/v5-patch-for-react-19'

// Initialize logger
import { loggerService } from '@logger'
// Context providers
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
// Redux store
import store, { persistor } from '@renderer/store'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

// Minimal chat component (conversation only)
import MinimalChat from './MinimalChat'

loggerService.initWindowSource('sidepanel')

// Initialize KeyvStorage
;(async () => {
  try {
    const KeyvStorage = (await import('@kangfenmao/keyv-storage')).default
    window.keyv = new KeyvStorage()
    window.keyv.init()
    console.log('[sidepanel] KeyvStorage initialized')
  } catch (error) {
    console.error('[sidepanel] Failed to initialize KeyvStorage:', error)
  }
})()

function SidepanelApp() {
  return (
    <StrictMode>
      <Provider store={store}>
        <PersistGate loading={<LoadingScreen />} persistor={persistor}>
          <StyleSheetManager>
            <ThemeProvider>
              <MinimalChat />
            </ThemeProvider>
          </StyleSheetManager>
        </PersistGate>
      </Provider>
    </StrictMode>
  )
}

function LoadingScreen() {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: 'var(--color-background)',
        color: 'var(--color-text)'
      }}>
      Loading...
    </div>
  )
}

// Mount the app
const root = document.getElementById('root')
if (root) {
  createRoot(root).render(<SidepanelApp />)

  // Remove loading spinner after React renders
  setTimeout(() => {
    const spinner = document.getElementById('spinner')
    if (spinner) {
      spinner.style.opacity = '0'
      spinner.style.transition = 'opacity 0.3s ease'
      setTimeout(() => spinner.remove(), 300)
    }
  }, 100)
} else {
  console.error('[sidepanel] Root element not found')
}

console.log('[sidepanel] Sidepanel loaded')
