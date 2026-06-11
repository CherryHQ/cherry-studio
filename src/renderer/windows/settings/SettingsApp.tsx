import { Alert, Button } from '@cherrystudio/ui'
import TopViewContainer from '@renderer/components/TopView'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { NotificationProvider } from '@renderer/context/NotificationProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { CommandProvider, ContextKeyProvider } from '@renderer/features/command'
import useMacTransparentWindow from '@renderer/hooks/useMacTransparentWindow'
import { useWindowInitData } from '@renderer/hooks/useWindowInitData'
import i18n from '@renderer/i18n'
import { routeTree } from '@renderer/routeTree.gen'
import NavigationService from '@renderer/services/NavigationService'
import store from '@renderer/store'
import { formatErrorMessage } from '@renderer/utils/error'
import { cn } from '@renderer/utils/style'
import { normalizeSettingsPath } from '@shared/data/types/settingsPath'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router'
import { type CSSProperties, useEffect, useMemo } from 'react'
import { Provider } from 'react-redux'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

export function SettingsWindowFatalError({ error }: { error: unknown }) {
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

function SettingsApp({ initialPath }: { initialPath: string }): React.ReactElement {
  const shellStyle = { '--navbar-height': '0px', '--settings-width': '200px' } as CSSProperties
  const isMacTransparentWindow = useMacTransparentWindow()

  return (
    <Provider store={store}>
      <QueryClientProvider client={queryClient}>
        <StyleSheetManager>
          <ThemeProvider>
            <AntdProvider>
              <NotificationProvider>
                <CodeStyleProvider>
                  <ContextKeyProvider>
                    <CommandProvider>
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
                    </CommandProvider>
                  </ContextKeyProvider>
                </CodeStyleProvider>
              </NotificationProvider>
            </AntdProvider>
          </ThemeProvider>
        </StyleSheetManager>
      </QueryClientProvider>
    </Provider>
  )
}

export default SettingsApp
