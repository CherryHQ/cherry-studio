import { Copy, Globe, LoaderCircle, MoreHorizontal, Search, SquareArrowOutUpRight, Trash2 } from 'lucide-react'
import { type UIEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Button,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Input,
  Tooltip
} from '@cherrystudio/ui'
import { useInfiniteFlatItems, useInfiniteQuery, useMutation } from '@data/hooks/useDataApi'
import { useDataChange } from '@data/hooks/useDataChange'
import { GroupedVirtualList } from '@renderer/components/VirtualList'
import { useTabs } from '@renderer/hooks/tab'
import { toast } from '@renderer/services/toast'
import type { BrowserVisit } from '@shared/data/api/schemas/browserVisits'

export function BrowserHistoryDialog({ onOpenPage }: { onOpenPage: () => void }) {
  const { t, i18n } = useTranslation()
  const [search, setSearch] = useState('')
  const pendingLoad = useRef(false)
  const query = useMemo(() => ({ search }), [search])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const { openTab } = useTabs()
  const {
    pages,
    hasNext,
    loadNext,
    error: historyError,
    isLoading,
    isRefreshing,
    refresh: refetch
  } = useInfiniteQuery('/browser-visits', { query, limit: 50, swrOptions: { keepPreviousData: false } })
  const items = useInfiniteFlatItems(pages)
  const { trigger: deleteVisit } = useMutation('DELETE', '/browser-visits/:id')
  useDataChange('/browser-visits', () => void refetch())

  useEffect(() => {
    pendingLoad.current = false
  }, [pages, historyError, isRefreshing])
  const loadMore = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      const element = event.currentTarget
      if (
        hasNext &&
        !isRefreshing &&
        !historyError &&
        !pendingLoad.current &&
        element.scrollHeight - element.scrollTop - element.clientHeight < 160
      ) {
        pendingLoad.current = true
        loadNext()
      }
    },
    [hasNext, isRefreshing, historyError, loadNext]
  )

  const locale = i18n.resolvedLanguage ?? i18n.language
  const timeFormat = useMemo(() => new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }), [locale])
  const groups = useMemo(() => {
    const today = new Date()
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    const relative = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    const dateFormat = new Intl.DateTimeFormat(locale, { dateStyle: 'long' })
    const grouped = new Map<string, { label: string; visits: BrowserVisit[] }>()
    for (const visit of items) {
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
    return [...grouped.entries()].map(([day, { label, visits }]) => ({ group: day, header: label, items: visits }))
  }, [items, locale])

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

  const openVisit = (visit: BrowserVisit) =>
    void run(async () => {
      openTab(`/app/browser?${new URLSearchParams({ url: visit.url })}`, {
        title: visit.title || visit.url,
        forceNew: true
      })
      onOpenPage()
    })

  return (
    <DialogContent
      size="xl"
      closeLabel={t('common.close')}
      className="flex h-[min(40rem,85dvh)] flex-col gap-0 overflow-hidden border border-border bg-popover p-0 text-popover-foreground">
      {isRefreshing && (
        <p role="status" className="absolute top-6 right-14 flex items-center gap-2 text-muted-foreground text-xs">
          <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {t('common.loading')}
        </p>
      )}
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
      <div className="@container min-h-0 flex-1 px-4 pb-4" aria-busy={isRefreshing}>
        {isLoading && !items.length ? (
          <p role="status" className="flex items-center justify-center gap-2 py-10 text-muted-foreground text-sm">
            <LoaderCircle aria-hidden="true" className="size-4 motion-safe:animate-spin" />
            {t('common.loading')}
          </p>
        ) : !historyError && !items.length ? (
          <div className="space-y-2 py-10 text-center text-muted-foreground text-sm">
            <p>{t(search ? 'settings.browser.noResults' : 'settings.browser.empty')}</p>
            {search && (
              <Button
                variant="ghost"
                onClick={() => {
                  setSearch('')
                }}>
                {t('common.clear')}
              </Button>
            )}
          </div>
        ) : (
          <GroupedVirtualList
            key={search}
            groups={groups}
            className="h-full"
            role="list"
            scrollerProps={{ 'aria-label': t('settings.browser.history'), tabIndex: 0 }}
            onScroll={loadMore}
            estimateGroupHeaderSize={() => 32}
            estimateItemSize={() => 40}
            renderGroupHeader={(label) => (
              <h3 className="px-2 pt-2 pb-2 font-medium text-muted-foreground text-xs capitalize">{label}</h3>
            )}
            renderItem={(visit) => {
              const title = visit.title || visit.url
              const host = new URL(visit.url).host.replace(/^www\./, '')
              return (
                <div
                  role="listitem"
                  key={visit.id}
                  className="group flex min-w-0 items-center gap-2 rounded-lg pe-1 focus-within:bg-accent/50 hover:bg-accent/50">
                  <Tooltip asChild content={<p className="max-w-sm break-all text-xs">{visit.url}</p>}>
                    <Button
                      variant="ghost"
                      className="h-10 min-w-0 flex-1 justify-start gap-3 px-2 text-start font-normal hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-ring"
                      aria-label={title}
                      aria-description={t('common.open_in_new_tab')}
                      disabled={busy || isRefreshing}
                      onClick={() => openVisit(visit)}>
                      <Avatar className="size-4 shrink-0 rounded-none" aria-hidden="true">
                        <AvatarImage src={visit.favicon} alt="" />
                        <AvatarFallback className="rounded-none bg-transparent">
                          <Globe className="size-4 text-muted-foreground" />
                        </AvatarFallback>
                      </Avatar>
                      <span
                        id={`browser-history-title-${visit.id}`}
                        className="min-w-0 flex-1 truncate text-foreground text-sm">
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
                        className="shrink-0 text-muted-foreground hover:bg-transparent focus-visible:bg-transparent focus-visible:ring-1 focus-visible:ring-ring">
                        <MoreHorizontal aria-hidden="true" className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="max-w-[min(20rem,calc(100vw-2rem))]">
                      <DropdownMenuItem onSelect={() => openVisit(visit)}>
                        <SquareArrowOutUpRight aria-hidden="true" />
                        {t('common.open_in_new_tab')}
                      </DropdownMenuItem>
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
                            await refetch()
                          })
                        }>
                        <Trash2 aria-hidden="true" />
                        {t('common.delete')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              )
            }}
          />
        )}
      </div>
    </DialogContent>
  )
}
