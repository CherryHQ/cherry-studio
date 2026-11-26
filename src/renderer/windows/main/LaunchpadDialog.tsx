import { lazy, Suspense, type RefObject } from 'react'
import { useTranslation } from 'react-i18next'

import { Dialog, DialogContent, DialogTitle } from '@cherrystudio/ui'

const LaunchpadContent = lazy(() =>
  import('@renderer/pages/launchpad/LaunchpadContent').then((module) => ({ default: module.LaunchpadContent }))
)

export function LaunchpadDialog({
  open,
  onOpenChange,
  onOpen,
  minimal,
  returnFocusRef
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpen: (url: string) => void
  minimal: boolean
  returnFocusRef: RefObject<HTMLElement | null>
}) {
  const { t } = useTranslation()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        motion="fade-scale"
        showCloseButton={false}
        aria-describedby={undefined}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          returnFocusRef.current?.focus()
        }}
        overlayClassName="bg-background/60 backdrop-blur-2xl"
        className="inset-0 flex h-dvh w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none bg-transparent p-0 shadow-none sm:max-w-none">
        <DialogTitle className="sr-only">{t('title.launchpad')}</DialogTitle>
        <Suspense fallback={null}>
          <LaunchpadContent
            compact={minimal}
            onDismiss={() => onOpenChange(false)}
            onOpen={(url) => {
              onOpenChange(false)
              onOpen(url)
            }}
          />
        </Suspense>
      </DialogContent>
    </Dialog>
  )
}
