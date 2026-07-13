import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { createPopup, type PopupInjectedProps } from '@renderer/services/popup'
import { lazy, Suspense } from 'react'
import { useTranslation } from 'react-i18next'

// Deferred so the popup's imperative shell (this module, statically imported by
// AppShell / ShellTabBarActions / AgentChatNavbar) no longer
// drags the panel's heavy graph — the chat message renderer and resource-edit
// dialogs — into the window's first-screen modulepreload set. The panel loads
// on first open instead.
const GlobalSearchPanel = lazy(() =>
  import('@renderer/components/GlobalSearch/GlobalSearchPanel').then((module) => ({
    default: module.GlobalSearchPanel
  }))
)

type Props = PopupInjectedProps<any>

const PopupContainer: React.FC<Props> = ({ open, resolve }) => {
  const { t } = useTranslation()

  const close = () => resolve({})

  return (
    <Dialog open={open} onOpenChange={(next) => !next && close()}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="z-1001 bg-black/50 backdrop-blur-[8px]"
        className="z-1001 flex h-[70vh] max-h-[600px] w-[640px] max-w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden rounded-2xl border border-border-subtle bg-background p-0 shadow-2xl sm:max-w-[640px]">
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
