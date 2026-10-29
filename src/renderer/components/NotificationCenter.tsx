import { Bell, X } from 'lucide-react'
import { lazy, Suspense, useState } from 'react'
import { useTranslation } from 'react-i18next'

import {
  Button,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Scrollbar,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  Tooltip
} from '@cherrystudio/ui'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NotificationCategory, NotificationRecord } from '@shared/data/types/notification'

import NotificationAnnouncement from './NotificationAnnouncement'
import { notificationCategoryIcons, notificationPreview } from './notificationPresentation'
import { NotificationTitle } from './NotificationTitle'

const logger = loggerService.withContext('NotificationCenter')
const ReleaseNotes = lazy(() => import('./ReleaseNotes').then((module) => ({ default: module.ReleaseNotes })))
const categories = ['all', 'system', 'usage', 'official'] as const
type Filter = 'all' | NotificationCategory

function NotificationItem({
  record,
  initiallyExpanded = false,
  onNavigate,
  onDismiss
}: {
  record: NotificationRecord
  initiallyExpanded?: boolean
  onNavigate: () => void
  onDismiss: () => void
}) {
  const { t, i18n } = useTranslation()
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [activating, setActivating] = useState(false)
  const { appUpdateState, checkForUpdate } = useAppUpdateState(async (releaseInfo) => {
    const { default: UpdateDialogPopup } = await import('./UpdateDialogPopup')
    return UpdateDialogPopup.show({ releaseInfo })
  })
  const { trigger: markRead } = useMutation('PATCH', '/notifications/:id', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  const { trigger: dismiss, isLoading: dismissing } = useMutation('DELETE', `/notifications/${record.id}`, {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  const release = record.target?.kind === 'release' ? record.target : null
  const announcement = record.target?.kind === 'announcement' ? record.target : null
  const announcementUrl = announcement?.url
  const expandable = !!(release || announcement)
  const Icon = notificationCategoryIcons[record.category]
  const isError = record.target?.result?.status === 'failed' || record.target?.result?.status === 'interrupted'
  const canUpdate = release && appUpdateState.available && appUpdateState.info?.version === release.version

  const activate = async () => {
    setActivating(true)
    try {
      if (expandable) {
        if (record.readAt === null) await markRead({ params: { id: record.id }, body: { read: true } })
        setExpanded(!expanded)
      } else {
        await ipcApi.request('notification.activate', { id: record.id })
        onNavigate()
      }
    } catch (error) {
      logger.error('Failed to activate notification', error as Error)
      toast.error(t('notification.center.activation_failed'))
    } finally {
      setActivating(false)
    }
  }

  return (
    <li className="border-b border-border-subtle last:border-0">
      <div className="relative py-2">
        <Button
          variant="ghost"
          aria-label={record.title}
          aria-expanded={expandable ? expanded : undefined}
          className="h-auto w-full min-w-0 items-start justify-start gap-3 whitespace-normal px-2 py-2 text-left"
          disabled={activating}
          onClick={() => void activate()}>
          <Icon
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 ${isError ? 'text-error' : 'text-muted-foreground'}`}
          />
          <span className="min-w-0 flex-1">
            <span className="mb-2 flex items-center gap-2 pr-8 font-medium">
              {record.readAt === null && (
                <span className="size-1.5 shrink-0 rounded-full bg-primary">
                  <span className="sr-only">{t('notification.center.unread')}</span>
                </span>
              )}
              <span className="min-w-0 flex-1 truncate">
                <NotificationTitle record={record} />
              </span>
            </span>
            {announcement ? (
              <NotificationAnnouncement id={record.id} announcement={announcement} expanded={expanded} />
            ) : (
              <span
                className={`block max-h-[2lh] overflow-hidden break-words text-sm ${isError ? 'text-error' : 'text-muted-foreground'}`}>
                {notificationPreview(record.message)}
              </span>
            )}
            <time
              dateTime={new Date(record.createdAt).toISOString()}
              className="mt-1 block text-xs text-muted-foreground">
              {new Date(record.createdAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
              {record.target?.result?.durationMs !== undefined && (
                <>
                  {' '}
                  ·{' '}
                  {new Intl.NumberFormat(i18n.language, {
                    style: 'unit',
                    unit: 'second',
                    maximumFractionDigits: 1
                  }).format(record.target?.result.durationMs / 1000)}
                </>
              )}
            </time>
          </span>
        </Button>
        <Tooltip content={t('notification.center.dismiss', { title: record.title })} asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="absolute right-1 top-3"
            aria-label={t('notification.center.dismiss', { title: record.title })}
            loading={dismissing}
            onClick={() =>
              void dismiss()
                .then(onDismiss)
                .catch((error) => {
                  logger.error('Failed to dismiss notification', error as Error)
                  toast.error(t('notification.center.error'))
                })
            }>
            <X className="size-4" />
          </Button>
        </Tooltip>
      </div>
      {expanded && (release || announcementUrl) && (
        <div className="space-y-3 px-3 pb-4">
          {release && (
            <Suspense fallback={<p className="text-sm text-muted-foreground">{t('common.loading')}</p>}>
              <ReleaseNotes content={release.releaseNotes} />
            </Suspense>
          )}
          {announcementUrl && (
            <Button
              variant="outline"
              onClick={() =>
                void ipcApi
                  .request('system.shell.open_website', announcementUrl)
                  .catch((error) => logger.error('Failed to open announcement link', error as Error))
              }>
              {t('common.open')}
            </Button>
          )}
          {canUpdate && appUpdateState.lastErrorKey && (
            <p role="alert" className="text-sm text-destructive">
              {t(appUpdateState.lastErrorKey)}
            </p>
          )}
          {canUpdate && (
            <Button
              onClick={() => void checkForUpdate()}
              disabled={appUpdateState.checking || appUpdateState.downloading}>
              {appUpdateState.downloading
                ? `${t('settings.about.downloading')} ${Math.round(appUpdateState.downloadProgress)}%`
                : appUpdateState.downloaded
                  ? t('update.install')
                  : t('notification.center.update_now')}
            </Button>
          )}
        </div>
      )}
    </li>
  )
}

function NotificationList({
  filter,
  requestedId,
  onNavigate,
  onDismissRequested
}: {
  filter: Filter
  requestedId: string | null
  onNavigate: () => void
  onDismissRequested: () => void
}) {
  const { t } = useTranslation()
  const { pages, hasNext, loadNext, isLoading, isRefreshing, error, refresh } = useInfiniteQuery('/notifications', {
    limit: 50,
    query: filter === 'all' ? undefined : { category: filter }
  })
  const items = useInfiniteFlatItems(pages)
  const {
    data: requested,
    error: requestedError,
    refetch: refetchRequested
  } = useQuery('/notifications/:id', {
    params: { id: requestedId ?? '' },
    enabled: !!requestedId,
    swrOptions: { shouldRetryOnError: false }
  })
  useDataChange('/notifications', () => {
    void refresh()
    if (requestedId) void refetchRequested()
  })
  const requestedRecord = !requestedError && requestedId && requested?.id === requestedId ? requested : undefined
  const visibleItems = requestedRecord ? [requestedRecord, ...items.filter((item) => item.id !== requestedId)] : items

  return (
    <>
      {requestedError && (
        <p role="status" className="p-3 text-sm text-muted-foreground">
          {t('notification.center.unavailable')}
        </p>
      )}
      {isLoading && (
        <p role="status" className="p-6 text-center text-sm text-muted-foreground">
          {t('common.loading')}
        </p>
      )}
      {error && (
        <div role="alert" className="space-y-2 p-4 text-sm text-muted-foreground">
          <p>{t('notification.center.error')}</p>
          <Button variant="outline" onClick={() => void refresh()}>
            {t('common.retry')}
          </Button>
        </div>
      )}
      {!isLoading && !error && visibleItems.length === 0 && (
        <p className="p-8 text-center text-sm text-muted-foreground">{t('notification.center.empty')}</p>
      )}
      <ul aria-label={t('notification.center.title')}>
        {visibleItems.map((record) => (
          <NotificationItem
            key={`${record.id}:${requestedId === record.id}`}
            record={record}
            initiallyExpanded={requestedId === record.id}
            onNavigate={onNavigate}
            onDismiss={record.id === requestedId ? onDismissRequested : () => {}}
          />
        ))}
      </ul>
      {hasNext && (
        <Button variant="ghost" className="my-2 w-full" loading={isRefreshing} onClick={loadNext}>
          {t('notification.center.load_more')}
        </Button>
      )}
    </>
  )
}

export function NotificationCenterButton() {
  const { t } = useTranslation()
  const categoryLabels = {
    all: t('notification.center.all'),
    system: t('notification.center.system'),
    usage: t('notification.center.usage'),
    official: t('notification.center.official')
  }
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const { data: unread, refetch } = useQuery('/notifications/unread-count')
  const { trigger: markAllRead, isLoading: markingAllRead } = useMutation('POST', '/notifications/read-all', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  useDataChange('/notifications/unread-count', () => {
    void refetch()
  })
  useIpcOn('notification.open', ({ id }) => {
    setFilter('all')
    setRequestedId(id)
    setOpen(true)
  })
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (!value) setRequestedId(null)
  }

  return (
    <Popover open={open} onOpenChange={changeOpen}>
      <Tooltip content={t('notification.center.title')}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className="relative size-8 text-muted-foreground"
            aria-label={t('notification.center.title')}>
            <Bell className="size-4" />
            {!!unread?.count && (
              <span className="absolute -right-1 -top-0.5 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
                {unread.count > 99 ? '99+' : unread.count}
              </span>
            )}
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent
        align="end"
        className="w-[420px] max-w-[calc(100vw-24px)] p-0"
        aria-label={t('notification.center.title')}>
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <h2 className="font-medium text-sm">{t('notification.center.title')}</h2>
          <Button
            variant="ghost"
            size="sm"
            disabled={!unread?.count}
            loading={markingAllRead}
            onClick={() =>
              void markAllRead().catch((error) => {
                logger.error('Failed to mark notifications read', error as Error)
                toast.error(t('notification.center.error'))
              })
            }>
            {t('notification.center.mark_all_read')}
          </Button>
        </div>
        <Tabs
          value={filter}
          onValueChange={(value) => {
            setFilter(value as Filter)
            setRequestedId(null)
          }}
          className="gap-0">
          <TabsList className="mx-3 mb-2 grid w-auto grid-cols-4">
            {categories.map((category) => {
              const Icon = category === 'all' ? Bell : notificationCategoryIcons[category]
              return (
                <TabsTrigger key={category} value={category}>
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  {categoryLabels[category]}
                </TabsTrigger>
              )
            })}
          </TabsList>
          <TabsContent value={filter} className="m-0">
            <Scrollbar className="max-h-[min(65vh,560px)] px-2">
              <NotificationList
                key={filter}
                filter={filter}
                requestedId={requestedId}
                onNavigate={() => changeOpen(false)}
                onDismissRequested={() => setRequestedId(null)}
              />
            </Scrollbar>
          </TabsContent>
        </Tabs>
        <p className="border-t border-border-subtle px-4 py-2 text-xs text-muted-foreground">
          {t('notification.center.retention')}
        </p>
      </PopoverContent>
    </Popover>
  )
}
