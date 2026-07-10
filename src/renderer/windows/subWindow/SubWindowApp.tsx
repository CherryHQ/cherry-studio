import { preferenceService } from '@data/PreferenceService'
import { CodeStyleProvider } from '@renderer/components/CodeStyleProvider'
import { CommandContextKeyProvider, CommandProvider } from '@renderer/components/command'
import { TabsProvider } from '@renderer/components/layout/TabsProvider'
import { PopupHost } from '@renderer/components/PopupHost'
import { ThemeProvider } from '@renderer/components/ThemeProvider'
import ToastHost from '@renderer/components/ToastHost'
import { useAppInit } from '@renderer/hooks/useAppInit'
import { SubWindowAppShell } from '@renderer/windows/subWindow/SubWindowAppShell'

void preferenceService.preloadAll()

// Behavior leaf inside the providers: runs the shared per-window init and mounts
// the popup/toast hosts. The subWindow has no window-specific init hooks.
function SubWindowRuntime(): React.ReactElement {
  useAppInit()

  return (
    <>
      <PopupHost />
      <ToastHost />
    </>
  )
}

function SubWindowApp(): React.ReactElement {
  return (
    <ThemeProvider>
      <CodeStyleProvider>
        <CommandContextKeyProvider>
          <CommandProvider>
            <TabsProvider initialDefaultTab={null} includePinnedTabs={false}>
              <SubWindowAppShell />
              <SubWindowRuntime />
            </TabsProvider>
          </CommandProvider>
        </CommandContextKeyProvider>
      </CodeStyleProvider>
    </ThemeProvider>
  )
}

export default SubWindowApp
