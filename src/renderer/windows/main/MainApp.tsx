import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { AppShell } from '@renderer/components/layout/AppShell'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import TopViewContainer from '@renderer/components/TopView'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const logger = loggerService.withContext('MainApp')

void preferenceService.preloadAll()

// 创建 React Query 客户端
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      refetchOnWindowFocus: false
    }
  }
})

function MainApp(): React.ReactElement {
  logger.info('MainApp initialized')

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <CodeStyleProvider>
          <CommandContextKeyProvider>
            <CommandProvider>
              <TabsProvider>
                <TopViewContainer>
                  <AppShell />
                </TopViewContainer>
              </TabsProvider>
            </CommandProvider>
          </CommandContextKeyProvider>
        </CodeStyleProvider>
      </ThemeProvider>
    </QueryClientProvider>
  )
}

export default MainApp
