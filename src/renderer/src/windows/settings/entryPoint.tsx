import '@renderer/assets/styles/index.css'
import '@renderer/assets/styles/tailwind.css'
import '@ant-design/v5-patch-for-react-19'
import '@renderer/databases'

import { Alert, Button } from '@cherrystudio/ui'
import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import TopViewContainer from '@renderer/components/TopView'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { NotificationProvider } from '@renderer/context/NotificationProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { useWindowInitData } from '@renderer/core/hooks/useWindowInitData'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import i18n from '@renderer/i18n'
import { routeTree } from '@renderer/routeTree.gen'
import NavigationService from '@renderer/services/NavigationService'
import store, { persistor } from '@renderer/store'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import type { UnifiedPreferenceKeyType } from '@shared/data/preference/preferenceTypes'
import { DEFAULT_SETTINGS_PATH, normalizeSettingsPath } from '@shared/data/types/settingsPath'
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
  'ui.window_style',
  'ui.theme_user.color_primary',
  'chat.code.editor.enabled',
  'chat.code.editor.theme_light',
  'chat.code.editor.theme_dark',
  'chat.code.viewer.theme_light',
  'chat.code.viewer.theme_dark'
]

const logger = loggerService.withContext('SettingsWindowEntry')

async function preloadSettingsPreferences() {
  try {
    await preferenceService.preload(SETTINGS_SHELL_PREFERENCE_KEYS)
    return null
  } catch (error) {
    logger.error('Failed to preload settings preferences', error as Error)
    return error
  }
}

async function getInitialSettingsPath() {
  try {
    return normalizeSettingsPath(await window.api.windowManager.getInitData<unknown>())
  } catch (error) {
    logger.error('Failed to get settings window init data', error as Error)
    return DEFAULT_SETTINGS_PATH
  }
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

function SettingsWindowFatalError({ error }: { error: unknown }) {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-background p-4 text-foreground">
      <Alert
        type="error"
        showIcon
        message={i18n.t('error.boundary.default.message')}
        description={formatErrorMessage(error)}
        action={
          <Button size="sm" onClick={() => void window.api.reload()}>
            {i18n.t('error.boundary.default.reload')}
          </Button>
        }
        className="max-w-xl"
      />
    </div>
  )
}

function SettingsWindowRouter({ initialPath }: { initialPath: string }) {
  const router = useMemo(() => {
    const history = createMemoryHistory({ initialEntries: [normalizeSettingsPath(initialPath)] })
    return createRouter({ routeTree, history })
  }, [initialPath])
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

function SettingsWindowApp({ initialPath }: { initialPath: string }): React.ReactElement {
  const shellStyle = { '--navbar-height': '0px' } as CSSProperties
  const isMacTransparentWindow = useMacTransparentWindow()

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
                        className={cn(
                          'flex h-screen w-screen overflow-hidden text-foreground',
                          isMacTransparentWindow ? 'bg-transparent' : 'bg-background'
                        )}
                        style={shellStyle}>
                        <SettingsWindowRouter initialPath={initialPath} />
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
const preloadError = await preloadSettingsPreferences()
const initialSettingsPath = preloadError ? DEFAULT_SETTINGS_PATH : await getInitialSettingsPath()

root.render(
  preloadError ? (
    <SettingsWindowFatalError error={preloadError} />
  ) : (
    <SettingsWindowApp initialPath={initialSettingsPath} />
  )
)
