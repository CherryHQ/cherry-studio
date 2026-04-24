import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'
import '@renderer/databases'

import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import TopViewContainer from '@renderer/components/TopView'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { NotificationProvider } from '@renderer/context/NotificationProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { useWindowInitData } from '@renderer/core/hooks/useWindowInitData'
import { routeTree } from '@renderer/routeTree.gen'
import NavigationService from '@renderer/services/NavigationService'
import store, { persistor } from '@renderer/store'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { type CSSProperties, useEffect, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import { Provider } from 'react-redux'
import { PersistGate } from 'redux-persist/integration/react'

loggerService.initWindowSource('SettingsWindow')

const SETTINGS_SHELL_PREFERENCE_KEYS: UnifiedPreferenceKeyType[] = [
  'app.language',
  'ui.theme_mode',
  'ui.theme_user.color_primary',
  'chat.code.editor.enabled',
  'chat.code.editor.theme_light',
  'chat.code.editor.theme_dark',
  'chat.code.viewer.theme_light',
  'chat.code.viewer.theme_dark'
]

void preferenceService.preload(SETTINGS_SHELL_PREFERENCE_KEYS)

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

const normalizeSettingsPath = (path: unknown): '/settings/provider' | `/settings${string}` => {
  if (typeof path === 'string' && path.startsWith('/settings')) {
    return path as `/settings${string}`
  }
  return '/settings/provider'
}

function SettingsWindowRouter() {
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries: ['/settings/provider'] })
    return createRouter({ routeTree, history })
  }, [])
  const targetPath = useWindowInitData<string>()

  useEffect(() => {
    NavigationService.setNavigate(router.navigate)
  }, [router])

  useEffect(() => {
    if (!targetPath) return
    void router.navigate({ to: normalizeSettingsPath(targetPath) })
  }, [router, targetPath])

  return <RouterProvider router={router} />
}

function SettingsWindowApp(): React.ReactElement {
  const shellStyle = { '--navbar-height': '0px' } as CSSProperties

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <StyleSheetManager>
          <ThemeProvider>
            <AntdProvider>
              <NotificationProvider>
                <CodeStyleProvider>
                  <PersistGate loading={null} persistor={persistor}>
                    <TopViewContainer>
                      <div
                        className="flex h-screen w-screen overflow-hidden bg-background text-foreground"
                        style={shellStyle}>
                        <SettingsWindowRouter />
                      </div>
                    </TopViewContainer>
                  </PersistGate>
                </CodeStyleProvider>
              </NotificationProvider>
            </AntdProvider>
          </ThemeProvider>
        </StyleSheetManager>
      </QueryClientProvider>
    </Provider>
  )
}

const root = createRoot(document.getElementById('root') as HTMLElement)
root.render(<SettingsWindowApp />)
