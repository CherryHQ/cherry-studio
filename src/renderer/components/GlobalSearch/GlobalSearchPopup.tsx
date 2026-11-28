import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import type { GlobalSearchPanel as GlobalSearchPanelType } from '@renderer/components/GlobalSearch/GlobalSearchPanel'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'

// Deferred so the popup's imperative shell (this module, statically imported by
// AppShell / ShellTabBarActions / AgentChatNavbar) no longer
// drags the panel's heavy graph — the chat message renderer and resource-edit
// dialogs — into the window's first-screen modulepreload set. The panel loads
// on hover/idle prefetch or first open instead.
let panelModulePromise: Promise<{
  default: typeof GlobalSearchPanelType
}> | null = null

const loadGlobalSearchPanel = () => {
  panelModulePromise ??= import('@renderer/components/GlobalSearch/GlobalSearchPanel').then((module) => ({
    default: module.GlobalSearchPanel
  }))
  return panelModulePromise
}

export function preloadGlobalSearchPanel(): void {
  void loadGlobalSearchPanel().catch(() => {
    panelModulePromise = null
  })
}

const GlobalSearchPanel = lazy(loadGlobalSearchPanel)

type Props = PopupInjectedProps<any>

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()

  const close = () => resolve({})

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        data-ui="app.search"
        motion="fade-scale"
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="z-1001 bg-black/50 data-[state=open]:animation-duration-[45ms]! data-[state=closed]:animate-none!"
        className="z-1001 flex h-[80vh] max-h-[80vh] w-[60vw] max-w-[60vw] flex-col gap-0 overflow-hidden rounded-4xl border border-border-subtle bg-background p-0 shadow-2xl data-[state=open]:animation-duration-[45ms]! data-[state=closed]:animate-none! sm:max-w-[60vw]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('globalSearch.open')}</DialogTitle>
        </DialogHeader>
        <Suspense fallback={null}>
          <GlobalSearchPanel onClose={close} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

const GlobalSearchPopup = createPopup<Record<string, never>, any>(PopupContainer, { dismissResult: {} })

export default GlobalSearchPopup
