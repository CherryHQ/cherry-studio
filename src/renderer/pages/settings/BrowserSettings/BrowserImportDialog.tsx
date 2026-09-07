import {
  Button,
  Checkbox,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Label,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@cherrystudio/ui'
import { ipcApi } from '@renderer/ipc'
import type { BrowserImportReason, BrowserImportResult, BrowserImportSource } from '@shared/ipc/schemas/browserImport'
import { Check, ChevronRight, FileUp, LoaderCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

const browserNames = {
  chrome: 'Google Chrome',
  edge: 'Microsoft Edge',
  brave: 'Brave',
  firefox: 'Firefox',
  dia: 'Dia',
  comet: 'Comet',
  vivaldi: 'Vivaldi',
  opera: 'Opera',
  chromium: 'Chromium'
} satisfies Record<BrowserImportSource['browser'], string>
const reasonKeys = {
  expired: 'settings.browser.cookieExpired',
  partitioned: 'settings.browser.cookiePartitioned',
  app_bound: 'settings.browser.cookieAppBound',
  unsupported_encryption: 'settings.browser.cookieUnsupportedEncryption',
  key_unavailable: 'settings.browser.cookieKeyUnavailable',
  key_store_unavailable: 'settings.browser.cookieKeyStoreUnavailable',
  access_denied: 'settings.browser.cookieAccessDenied',
  decryption_failed: 'settings.browser.cookieDecryptionFailed',
  source_unavailable: 'settings.browser.cookieSourceUnavailable'
} as const satisfies Record<BrowserImportReason, string>

function profileLabel(source: BrowserImportSource): string {
  return [...new Set([source.displayName || source.profile, source.account].filter(Boolean))].join(' · ')
}

export function BrowserImportDialog({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation()
  const [sources, setSources] = useState<BrowserImportSource[]>([])
  const [sourceId, setSourceId] = useState('')
  const [loading, setLoading] = useState(true)
  const [scan, setScan] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const [history, setHistory] = useState(true)
  const [siteData, setSiteData] = useState(false)
  const [result, setResult] = useState<BrowserImportResult>()
  const source = sources.find((item) => item.id === sourceId)
  const file = sourceId === 'file'
  const browsers = [...new Set(sources.map((item) => item.browser))]
  const profiles = sources.filter((item) => item.browser === source?.browser)

  const selectSource = (item?: BrowserImportSource) => {
    setSourceId(item?.id ?? 'file')
    setHistory(item?.history ?? false)
    setSiteData(!item || item.cookies !== 'unavailable')
    setError(false)
  }
  useEffect(() => {
    let active = true
    setLoading(true)
    setError(false)
    ipcApi
      .request('browser.import.sources')
      .then((items) => {
        if (!active) return
        setSources(items)
        selectSource(items[0])
      })
      .catch(() => {
        if (active) setError(true)
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [scan])

  const importData = async () => {
    setBusy(true)
    setError(false)
    try {
      const imported = await ipcApi.request('browser.import.run', {
        sourceId: file ? undefined : sourceId,
        history: history && !!source?.history,
        cookies: siteData,
        localStorage: file && siteData,
        domains: []
      })
      if (
        !imported.cancelled ||
        [imported.history, imported.cookies, imported.localStorage].some(
          (item) => item.imported || item.failed || item.skipped
        )
      )
        setResult(imported)
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }
  const results = result
    ? [
        { label: t('settings.browser.history'), ...result.history },
        {
          label: t('settings.browser.site_data'),
          imported: result.cookies.imported + result.localStorage.imported,
          skipped: result.cookies.skipped + result.localStorage.skipped,
          failed: result.cookies.failed + result.localStorage.failed,
          unsupported: result.cookies.unsupported || result.localStorage.unsupported,
          reasons: result.cookies.reasons
        }
      ].filter((item) => item.imported || item.skipped || item.failed || item.unsupported)
    : []
  const incomplete = result?.cancelled || results.some((item) => item.failed || item.unsupported)

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
        <DialogTitle className="pe-6 leading-snug">{t('settings.browser.import')}</DialogTitle>
        <DialogDescription className="leading-relaxed">
          {t(
            result
              ? result.cookies.imported + result.localStorage.imported > 0
                ? 'settings.browser.importFinishHelp'
                : 'settings.browser.importReviewHelp'
              : 'settings.browser.importIntro'
          )}
        </DialogDescription>
      </DialogHeader>
      {loading ? (
        <p role="status" className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {t('common.loading')}
        </p>
      ) : result ? (
        <div role="status" className="space-y-4 py-2">
          <p className="flex items-center gap-2 font-medium text-sm">
            {!incomplete && <Check aria-hidden="true" className="size-4" />}
            {t(incomplete ? 'settings.browser.importPartial' : 'settings.browser.importComplete')}
          </p>
          {results.length ? (
            results.map((item) => (
              <div key={item.label} className="space-y-1 text-sm">
                <p>{item.label}</p>
                <p className="text-muted-foreground tabular-nums">{t('settings.browser.result', item)}</p>
                {(Object.keys(reasonKeys) as BrowserImportReason[]).map((reason) => {
                  const count = item.reasons?.[reason]
                  return count ? (
                    <p key={reason} className="text-muted-foreground leading-relaxed">
                      {t(reasonKeys[reason], { count })}
                    </p>
                  ) : null
                })}
                {item.unsupported && !item.reasons && (
                  <p className="text-muted-foreground">{t('settings.browser.unsupported')}</p>
                )}
              </div>
            ))
          ) : (
            <p className="text-muted-foreground text-sm">{t('settings.browser.importEmpty')}</p>
          )}
        </div>
      ) : (
        <div className="space-y-5 py-2">
          {sourceId && !file && (
            <div className="space-y-2">
              <Label htmlFor="browser-import-source">{t('settings.browser.source')}</Label>
              <Select
                value={source?.browser}
                onValueChange={(browser) => selectSource(sources.find((item) => item.browser === browser))}
                disabled={busy}>
                <SelectTrigger id="browser-import-source" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {browsers.map((browser) => (
                    <SelectItem key={browser} value={browser}>
                      {browserNames[browser]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {profiles.length === 1 && source && (source.displayName || source.account) && (
                <p className="break-words text-muted-foreground text-sm">{profileLabel(source)}</p>
              )}
              {profiles.length > 1 && (
                <div className="space-y-2 pt-2">
                  <Label htmlFor="browser-import-profile">{t('settings.browser.profile')}</Label>
                  <Select
                    value={sourceId}
                    onValueChange={(id) => selectSource(sources.find((item) => item.id === id))}
                    disabled={busy}>
                    <SelectTrigger id="browser-import-profile" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {profiles.map((item) => {
                        const label = profileLabel(item)
                        const duplicate = profiles.some(
                          (other) => other.id !== item.id && profileLabel(other) === label
                        )
                        return (
                          <SelectItem key={item.id} value={item.id}>
                            {label}
                            {duplicate ? ` (${item.profile})` : ''}
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>
          )}
          {file ? (
            <div className="space-y-2 text-sm">
              <p className="font-medium">{t('settings.browser.file')}</p>
              <p className="text-muted-foreground leading-relaxed">{t('settings.browser.fileHelp')}</p>
            </div>
          ) : (
            source && (
              <>
                <p className="text-muted-foreground text-sm">
                  {t(history || siteData ? 'settings.browser.importIncludes' : 'settings.browser.importOptions', {
                    items: [history && t('settings.browser.history'), siteData && t('settings.browser.site_data')]
                      .filter(Boolean)
                      .join(' · ')
                  })}
                </p>
                <details className="group">
                  <summary className="flex cursor-pointer list-none items-center gap-1 rounded-md py-1 text-sm outline-none focus-visible:bg-accent [&::-webkit-details-marker]:hidden">
                    <ChevronRight aria-hidden="true" className="size-4 transition-transform group-open:rotate-90" />
                    {t('settings.browser.importOptions')}
                  </summary>
                  <div className="space-y-3 ps-5 pt-3">
                    {source.history && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="browser-import-history"
                          checked={history}
                          disabled={busy}
                          onCheckedChange={(value) => setHistory(value === true)}
                        />
                        <Label htmlFor="browser-import-history">{t('settings.browser.history')}</Label>
                      </div>
                    )}
                    {source.cookies !== 'unavailable' && (
                      <div className="flex items-center gap-2">
                        <Checkbox
                          id="browser-import-site"
                          checked={siteData}
                          disabled={busy}
                          onCheckedChange={(value) => setSiteData(value === true)}
                        />
                        <Label htmlFor="browser-import-site">{t('settings.browser.site_data')}</Label>
                      </div>
                    )}
                  </div>
                </details>
              </>
            )
          )}
          {siteData && source?.cookies === 'requires_authorization' && (
            <p className="text-muted-foreground text-sm leading-relaxed">{t('settings.browser.encrypted')}</p>
          )}
          {(!file || sources.length > 0) && (
            <Button
              variant="ghost"
              className="h-auto justify-start px-0 text-muted-foreground"
              disabled={busy}
              onClick={() => selectSource(file ? sources[0] : undefined)}>
              <FileUp aria-hidden="true" className="size-4" />
              {t(file ? 'settings.browser.fromBrowser' : 'settings.browser.fromFile')}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-error text-sm">
          {t('settings.browser.error')}
          {!sourceId && (
            <Button variant="ghost" onClick={() => setScan((value) => value + 1)}>
              {t('common.refresh')}
            </Button>
          )}
        </p>
      )}
      <DialogFooter>
        {result ? (
          <Button onClick={onDone}>{t('common.close')}</Button>
        ) : (
          <>
            <DialogClose asChild>
              <Button variant="outline" disabled={busy}>
                {t('common.cancel')}
              </Button>
            </DialogClose>
            <Button
              disabled={loading || busy || !sourceId || (!history && !siteData)}
              onClick={() => void importData()}>
              {busy && <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />}
              {t(file ? 'settings.browser.file' : 'settings.browser.importAction')}
            </Button>
          </>
        )}
      </DialogFooter>
    </DialogContent>
  )
}
