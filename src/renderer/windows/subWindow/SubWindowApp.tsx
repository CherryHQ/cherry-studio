import { preferenceService } from '@data/PreferenceService'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import TopViewContainer from '@renderer/components/TopView/TopView'
import { SubWindowAppShell } from '@renderer/windows/subWindow/SubWindowAppShell'

void preferenceService.preloadAll()

function SubWindowApp(): React.ReactElement {
  return (
    <ThemeProvider>
      <CodeStyleProvider>
        <CommandContextKeyProvider>
          <CommandProvider>
            <TabsProvider initialDefaultTab={null} includePinnedTabs={false}>
              <TopViewContainer>
                <SubWindowAppShell />
              </TopViewContainer>
            </TabsProvider>
          </CommandProvider>
        </CommandContextKeyProvider>
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default SubWindowApp
