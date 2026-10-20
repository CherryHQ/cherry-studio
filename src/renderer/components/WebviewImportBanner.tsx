import { X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Dialog, DialogTrigger, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'

const BrowserImportDialog = lazy(() =>
  import('./BrowserImportDialog').then((module) => ({ default: module.BrowserImportDialog }))
)

export function WebviewImportBanner() {
  const { t } = useTranslation()
  const [hidden, setHidden] = usePersistCache('ui.browser.import_prompt_hidden')
  const [open, setOpen] = useState(false)

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {!hidden && (
        <div className="flex shrink-0 items-start gap-2 border-border border-b bg-background-subtle px-3 py-2">
          <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-2">
            <p className="min-w-0 flex-1 basis-48 text-muted-foreground text-sm leading-5">
              {t('webview.browser.import_hint')}
            </p>
            <DialogTrigger asChild>
              <Button size="sm" variant="outline">
                {t('settings.browser.import')}
              </Button>
            </DialogTrigger>
          </div>
          <Tooltip title={t('webview.browser.dismiss_import')}>
            <Button
              size="icon-sm"
              variant="ghost"
              aria-label={t('webview.browser.dismiss_import')}
              onClick={() => setHidden(true)}>
              <X aria-hidden="true" className="size-4" />
            </Button>
          </Tooltip>
        </div>
      )}
      {open && (
        <Suspense fallback={null}>
          <BrowserImportDialog onDone={() => setOpen(false)} />
        </Suspense>
      )}
    </Dialog>
  )
}
