import {
  Button,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label
} from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useDataChange } from '@data/hooks/useDataChange'
import { useTabs } from '@renderer/hooks/tab'
import { LoaderCircle } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserHistoryDialog({ onOpenPage }: { onOpenPage: () => void }) {
  const { t } = useTranslation()
  const [search, setSearch] = useState('')
  const [offset, setOffset] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { openTab } = useTabs()
  const {
    data,
    error: historyError,
    isLoading,
    isRefreshing,
    refetch
  } = useQuery('/browser-visits', { query: { search, offset, limit: 25 } })
  const { trigger: deleteVisit } = useMutation('DELETE', '/browser-visits/:id')
  useDataChange('/browser-visits', () => void refetch())

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true)
    setError(false)
    try {
      await action()
    } catch {
      setError(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <DialogContent size="xl" closeLabel={t('common.close')} className="flex max-h-[85dvh] flex-col">
      <DialogHeader className="shrink-0 text-start">
        <DialogTitle>{t('settings.browser.history')}</DialogTitle>
        <DialogDescription>{t('settings.browser.historyHelp')}</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 space-y-3">
        <Label htmlFor="browser-history-search">{t('settings.browser.search')}</Label>
        <Input
          id="browser-history-search"
          type="search"
          maxLength={500}
          value={search}
          onChange={(event) => {
            setSearch(event.target.value)
            setOffset(0)
          }}
        />
        {(error || historyError) && (
          <p role="alert" className="text-error text-sm">
            {t('settings.browser.error')}
            <Button variant="ghost" onClick={() => void run(refetch)}>
              {t('common.refresh')}
            </Button>
          </p>
        )}
      </div>
      <div className="min-h-0 overflow-y-auto overscroll-contain" aria-busy={isRefreshing}>
        {isLoading && !data ? (
          <p role="status" className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            {t('common.loading')}
          </p>
        ) : !historyError && !data?.items.length ? (
          <div className="space-y-2 py-10 text-center text-muted-foreground text-sm">
            <p>{t(search ? 'settings.browser.noResults' : 'settings.browser.empty')}</p>
            {search && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                  setOffset(0)
                }}>
                {t('common.clear')}
              </Button>
            )}
            {offset > 0 && (
              <Button variant="ghost" onClick={() => setOffset(0)}>
                {t('common.previous')}
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {data?.items.map((visit) => (
              <li key={visit.id} className="flex items-center gap-2 py-3">
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="truncate text-sm" title={visit.title || visit.url}>
                    {visit.title || visit.url}
                  </p>
                  <p className="truncate text-muted-foreground text-xs" dir="auto" title={visit.url}>
                    {visit.url}
                  </p>
                  <time
                    dateTime={new Date(visit.visitedAt).toISOString()}
                    className="block text-muted-foreground text-xs tabular-nums">
                    {new Date(visit.visitedAt).toLocaleString()}
                  </time>
                </div>
                <div className="flex shrink-0 flex-wrap gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || isRefreshing}
                    onClick={() =>
                      void run(async () => {
                        openTab(`/app/browser?${new URLSearchParams({ url: visit.url })}`, {
                          title: visit.title || visit.url,
                          forceNew: true
                        })
                        onOpenPage()
                      })
                    }>
                    {t('common.open_in_new_tab')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy || isRefreshing}
                    onClick={() =>
                      void run(async () => {
                        await deleteVisit({ params: { id: visit.id } })
                        if (data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 25))
                        else await refetch()
                      })
                    }>
                    {t('common.delete')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
      <DialogFooter className="shrink-0 sm:justify-between">
        <div className="flex gap-2">
          <Button
            variant="outline"
            disabled={offset === 0 || busy || isRefreshing}
            onClick={() => setOffset(Math.max(0, offset - 25))}>
            {t('common.previous')}
          </Button>
          <Button
            variant="outline"
            disabled={!data?.hasMore || busy || isRefreshing}
            onClick={() => setOffset(offset + 25)}>
            {t('common.next')}
          </Button>
        </div>
        <DialogClose asChild>
          <Button variant="outline">{t('common.close')}</Button>
        </DialogClose>
      </DialogFooter>
    </DialogContent>
  )
}
