import { preferenceService } from '@data/PreferenceService'
import { loggerService } from '@logger'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { AppShell } from '@renderer/components/layout/AppShell'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import TopViewContainer from '@renderer/components/TopView'

const logger = loggerService.withContext('MainApp')

void preferenceService.preloadAll()

function MainApp(): React.ReactElement {
  logger.info('MainApp initialized')

  return (
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
  )
}

export default MainApp
