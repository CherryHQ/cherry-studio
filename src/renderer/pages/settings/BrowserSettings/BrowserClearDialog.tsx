import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Checkbox,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label
} from '@cherrystudio/ui'
import { useMutation } from '@data/hooks/useDataApi'
import { ipcApi } from '@renderer/ipc'

const categories = [
  { kind: 'history', label: 'settings.browser.history', help: 'settings.browser.clearHistoryHelp' },
  { kind: 'site_data', label: 'settings.browser.site_data', help: 'settings.browser.clearSiteConfirm' },
  { kind: 'cache', label: 'settings.browser.cachedFiles', help: 'settings.browser.clearCacheHelp' }
] as const

export function BrowserClearDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [selected, setSelected] = useState({ history: false, site_data: false, cache: true })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { trigger: clearHistory } = useMutation('DELETE', '/browser-visits')

  const clear = async () => {
    setBusy(true)
    setError(false)
    try {
      for (const { kind } of categories) {
        if (!selected[kind]) continue
        if (kind === 'history') await clearHistory()
        else await ipcApi.request('browser.data.clear', { kind })
        setSelected((current) => ({ ...current, [kind]: false }))
      }
      onDone()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  return (
    <DialogContent
      closeLabel={t('common.close')}
      showCloseButton={!busy}
      closeOnOverlayClick={!busy}
      onEscapeKeyDown={(event) => {
        if (busy) event.preventDefault()
      }}
      className="max-h-[85dvh] overflow-y-auto overscroll-contain">
      <DialogHeader className="text-start">
        <DialogTitle className="pe-6 leading-snug">{t('settings.browser.clear')}</DialogTitle>
        <DialogDescription>{t('settings.browser.clearConfirm')}</DialogDescription>
      </DialogHeader>
      <div className="space-y-5 py-2">
        {categories.map(({ kind, label, help }) => (
          <div key={kind} className="flex items-start gap-3">
            <Checkbox
              className="mt-0.5"
              id={`browser-clear-${kind}`}
              aria-describedby={`browser-clear-${kind}-help`}
              checked={selected[kind]}
              disabled={busy}
              onCheckedChange={(value) => setSelected((current) => ({ ...current, [kind]: value === true }))}
            />
            <div className="space-y-1">
              <Label htmlFor={`browser-clear-${kind}`}>{t(label)}</Label>
              <p id={`browser-clear-${kind}-help`} className="text-muted-foreground text-sm leading-relaxed">
                {t(help)}
              </p>
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="text-error text-sm">
          {t('settings.browser.clearError')}
        </p>
      )}
      <DialogFooter>
        <DialogClose asChild>
          <Button variant="outline" disabled={busy}>
            {t('common.cancel')}
          </Button>
        </DialogClose>
        <Button
          variant="destructive"
          disabled={busy || !Object.values(selected).some(Boolean)}
          onClick={() => void clear()}>
          {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
          {t('common.clear')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}
