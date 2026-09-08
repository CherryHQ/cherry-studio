import {
  Button,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import { useMutation, useQuery } from '@data/hooks/useDataApi'
import { useDataChange } from '@data/hooks/useDataChange'
import { useTabs } from '@renderer/hooks/tab'
import { toast } from '@renderer/services/toast'
import type { BrowserVisit } from '@shared/data/api/schemas/browserVisits'
import { Copy, Globe, LoaderCircle, MoreHorizontal, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

export function BrowserHistoryDialog({ onOpenPage }: { onOpenPage: () => void }) {
  const { t, i18n } = useTranslation()
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

  const locale = i18n.resolvedLanguage ?? i18n.language
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const groups = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })
    const grouped = new Map<string, { label: string; visits: BrowserVisit[] }>()
    for (const visit of data?.items ?? []) {
      const date = new Date(visit.visitedAt)
      const day = date.toDateString()
      const label =
        day === today.toDateString()
          ? relative.format(0, 'day')
          : day === yesterday.toDateString()
            ? relative.format(-1, 'day')
            : dateFormat.format(date)
      const group = grouped.get(day)
      if (group) group.visits.push(visit)
      else grouped.set(day, { label, visits: [visit] })
    }
    return [...grouped.entries()]
  }, [data?.items, locale])

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
    <DialogContent
      size="xl"
      closeLabel={t('common.close')}
      className="flex h-[min(40rem,85dvh)] flex-col gap-0 overflow-hidden border border-border bg-popover p-0 text-popover-foreground">
      <DialogHeader className="shrink-0 px-6 pt-6 pb-4 text-start">
        <DialogTitle>{t('settings.browser.history')}</DialogTitle>
        <DialogDescription className="sr-only">{t('settings.browser.historyHelp')}</DialogDescription>
      </DialogHeader>
      <div className="shrink-0 space-y-3 px-6 pb-4">
        <div className="relative">
          <Search
            aria-hidden="true"
            className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-3 size-4 text-muted-foreground"
          />
          <Input
            id="browser-history-search"
            type="search"
            aria-label={t('common.search')}
            placeholder={t('settings.browser.search')}
            className="ps-9"
            maxLength={500}
            value={search}
            onChange={(event) => {
              setSearch(event.target.value)
              setOffset(0)
            }}
          />
        </div>
        {(error || historyError) && (
          <p role="alert" className="text-error text-sm">
            {t('settings.browser.error')}
            <Button variant="ghost" onClick={() => void run(refetch)}>
              {t('common.refresh')}
            </Button>
          </p>
        )}
      </div>
      <div className="@container min-h-0 flex-1 overflow-y-auto overscroll-contain px-4" aria-busy={isRefreshing}>
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
          <div className="space-y-5 pb-4">
            {groups.map(([day, group]) => (
              <section key={day} aria-label={group.label}>
                <h3 className="px-2 pb-2 font-medium text-muted-foreground text-xs capitalize">{group.label}</h3>
                <ul>
                  {group.visits.map((visit) => {
                    const title = visit.title || visit.url
                    const host = new URL(visit.url).host.replace(/^www\./, '')
                    return (
                      <li
                        key={visit.id}
                        className="group flex min-w-0 items-center gap-2 rounded-lg pe-1 focus-within:bg-accent/50 hover:bg-accent/50">
                        <Tooltip
                          asChild
                          content={
                            <div className="max-w-sm space-y-1">
                              <p>{title}</p>
                              <p className="break-all text-xs">{visit.url}</p>
                            </div>
                          }>
                          <Button
                            variant="ghost"
                            className="h-10 min-w-0 flex-1 justify-start gap-3 px-2 text-start font-normal"
                            aria-label={title}
                            aria-description={t('common.open_in_new_tab')}
                            disabled={busy || isRefreshing}
                            onClick={() =>
                              void run(async () => {
                                openTab(`/app/browser?${new URLSearchParams({ url: visit.url })}`, {
                                  title,
                                  forceNew: true
                                })
                                onOpenPage()
                              })
                            }>
                            <Globe aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
                            <span
                              id={`browser-history-title-${visit.id}`}
                              className="min-w-0 truncate text-foreground text-sm">
                              {title}
                            </span>
                            <span
                              className="@sm:inline hidden max-w-[30%] shrink-0 truncate text-muted-foreground text-xs"
                              dir="ltr"
                              aria-hidden="true">
                              {host}
                            </span>
                          </Button>
                        </Tooltip>
                        <time
                          dateTime={new Date(visit.visitedAt).toISOString()}
                          className="shrink-0 text-muted-foreground text-xs tabular-nums">
                          {timeFormat.format(visit.visitedAt)}
                        </time>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={t('common.more')}
                              aria-describedby={`browser-history-title-${visit.id}`}
                              disabled={busy || isRefreshing}
                              className="shrink-0 text-muted-foreground">
                              <MoreHorizontal aria-hidden="true" className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-2rem))]">
                            <DropdownMenuLabel className="break-all font-normal text-muted-foreground text-xs">
                              {visit.url}
                            </DropdownMenuLabel>
                            <DropdownMenuItem
                              onSelect={() =>
                                void run(async () => {
                                  await navigator.clipboard.writeText(visit.url)
                                  toast.success(t('common.copied'))
                                })
                              }>
                              <Copy aria-hidden="true" />
                              {t('common.copy')}
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              variant="destructive"
                              onSelect={() =>
                                void run(async () => {
                                  await deleteVisit({ params: { id: visit.id } })
                                  if (data?.items.length === 1 && offset > 0) setOffset(Math.max(0, offset - 25))
                                  else await refetch()
                                })
                              }>
                              <Trash2 aria-hidden="true" />
                              {t('common.delete')}
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </li>
                    )
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>
      <DialogFooter className="shrink-0 border-border-subtle border-t px-6 py-3 sm:justify-end">
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
      </DialogFooter>
    </DialogContent>
  )
}
