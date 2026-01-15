/**
 * Minimal Sidepanel Entry Point
 *
 * Loads a minimal chat-only version for the Chrome extension sidepanel.
 * Uses the same provider hierarchy as the full app but with a minimal Redux store.
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
// Context providers (minimal set)
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
// Use full store (tree-shaking will remove unused code)
import store, { persistor } from '@renderer/store'
import { QueryClient } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

// Minimal chat component
import MinimalChat from './MinimalChat'
loggerService.initWindowSource('sidepanel')

// Initialize KeyvStorage (same as full app)
;(async () => {
  try {
    const KeyvStorage = (await import('@kangfenmao/keyv-storage')).default
    window.keyv = new KeyvStorage()
    window.keyv.init()
    console.log('[sidepanel-minimal] KeyvStorage initialized')
  } catch (error) {
    console.error('[sidepanel-minimal] Failed to initialize KeyvStorage:', error)
  }
})()

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function MinimalApp() {
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
  createRoot(root).render(<MinimalApp />)

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
  console.error('[sidepanel-minimal] Root element not found')
}

console.log('[sidepanel-minimal] Minimal sidepanel loaded')
