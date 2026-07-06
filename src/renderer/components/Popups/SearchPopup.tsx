import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@cherrystudio/ui'
import { lazy, Suspense, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { TopView } from '../TopView/TopView'

// Deferred so the popup's imperative shell (this module, statically imported by
// AppShell / ShellTabBarActions / AgentChatNavbar / MessagesService) no longer
// drags the panel's heavy graph — the chat message renderer and resource-edit
// dialogs — into the window's first-screen modulepreload set. The panel loads
// on first open instead.
const GlobalSearchPanel = lazy(() =>
  import('@renderer/components/GlobalSearch/GlobalSearchPanel').then((module) => ({
    default: module.GlobalSearchPanel
  }))
)

const CLOSE_ANIMATION_MS = 200

interface Props {
  resolve: (data: any) => void
}

const PopupContainer: React.FC<Props> = ({ resolve }) => {
  const [open, setOpen] = useState(true)
  const resolvedRef = useRef(false)
  const { t } = useTranslation()

  const resolveAfterClose = () => {
    if (resolvedRef.current) return
    resolvedRef.current = true
    window.setTimeout(() => {
      resolve({})
    }, CLOSE_ANIMATION_MS)
  }

  const closePopup = () => {
    setOpen(false)
    resolveAfterClose()
  }

  const onOpenChange = (next: boolean) => {
    if (!next) {
      closePopup()
    }
  }

  SearchPopup.hide = closePopup

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        onOpenAutoFocus={(event) => event.preventDefault()}
        overlayClassName="z-1001 bg-black/50 backdrop-blur-[8px]"
        className="z-1001 flex h-[80vh] max-h-[80vh] w-[60vw] max-w-[60vw] flex-col gap-0 overflow-hidden rounded-4xl border border-border-subtle bg-background p-0 shadow-2xl sm:max-w-[60vw]">
        <DialogHeader className="sr-only">
          <DialogTitle>{t('globalSearch.open')}</DialogTitle>
        </DialogHeader>
        <Suspense fallback={null}>
          <GlobalSearchPanel onClose={closePopup} />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}

export default class SearchPopup {
  static topviewId = 0
  static hide() {
    TopView.hide('SearchPopup')
  }
  static show() {
    return new Promise<any>((resolve) => {
      TopView.show(
        <PopupContainer
          resolve={(v) => {
            resolve(v)
            TopView.hide('SearchPopup')
          }}
        />,
        'SearchPopup'
      )
    })
  }
}
