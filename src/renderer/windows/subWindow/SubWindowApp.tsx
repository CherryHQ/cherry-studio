import '@renderer/databases'

import { preferenceService } from '@data/PreferenceService'
import TopViewContainer from '@renderer/components/TopView'
import AntdProvider from '@renderer/context/AntdProvider'
import { CodeStyleProvider } from '@renderer/context/CodeStyleProvider'
import { NotificationProvider } from '@renderer/context/NotificationProvider'
import StyleSheetManager from '@renderer/context/StyleSheetManager'
import { TabsProvider } from '@renderer/context/TabsContext'
import { ThemeProvider } from '@renderer/context/ThemeProvider'
import { CommandProvider, ContextKeyProvider } from '@renderer/features/command'
import store from '@renderer/store'
import { SubWindowAppShell } from '@renderer/windows/subWindow/SubWindowAppShell'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Provider } from 'react-redux'

void preferenceService.preloadAll()

// Create React Query client
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      refetchOnWindowFocus: false
    }
  }
})

function SubWindowApp(): React.ReactElement {
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
                      <TabsProvider>
                        <TopViewContainer>
                          <SubWindowAppShell />
                        </TopViewContainer>
                      </TabsProvider>
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

export default SubWindowApp
