import { Bell, X } from 'lucide-react'
import { createContext, lazy, Suspense, use, useEffect, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Drawer, DrawerContent, DrawerTitle, DrawerDescription, Scrollbar, Tooltip } from '@cherrystudio/ui'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NotificationRecord } from '@shared/data/types/notification'

import NotificationAnnouncement from './NotificationAnnouncement'
import { notificationCategoryIcons, notificationPreview } from './notificationPresentation'
import { NotificationTitle } from './NotificationTitle'

const logger = loggerService.withContext('NotificationCenter')
const ReleaseNotes = lazy(() => import('./ReleaseNotes').then((module) => ({ default: module.ReleaseNotes })))
const NotificationCenterContext = createContext<{ open: boolean; hasUnread: boolean; toggle: () => void } | null>(null)

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
    <li data-requested={initiallyExpanded} className="border-b border-border-subtle last:border-0">
      <div className="relative py-2">
        <Button
          variant="ghost"
          aria-label={record.title}
          aria-expanded={expandable ? expanded : undefined}
          className="h-auto w-full min-w-0 items-start justify-start gap-3 whitespace-normal px-2 py-2 text-left"
          disabled={activating}
          onClick={() => void activate()}>
          <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
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
              <span className="block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground">
                {notificationPreview(record.message)}
              </span>
            )}
            <time
              dateTime={new Date(record.createdAt).toISOString()}
              className="mt-1 block text-xs text-muted-foreground">
              {new Date(record.createdAt).toLocaleString(i18n.language, { dateStyle: 'medium', timeStyle: 'short' })}
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
  requestedId,
  onNavigate,
  onDismissRequested
}: {
  requestedId: string | null
  onNavigate: () => void
  onDismissRequested: () => void
}) {
  const { t } = useTranslation()
  const { pages, hasNext, loadNext, isLoading, isRefreshing, error, refresh } = useInfiniteQuery('/notifications', {
    limit: 50
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
  const visibleItems = requestedRecord
    ? [...items.filter((item) => item.id !== requestedId), requestedRecord].sort(
        (a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id)
      )
    : items
  const listRef = useRef<HTMLUListElement>(null)
  useEffect(() => {
    if (requestedRecord) listRef.current?.querySelector('[data-requested="true"]')?.scrollIntoView({ block: 'nearest' })
  }, [requestedRecord])

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
      <ul ref={listRef} aria-label={t('notification.center.title')}>
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

export function NotificationCenterButton({ className = '' }: { className?: string }) {
  const { t } = useTranslation()
  const center = use(NotificationCenterContext)
  if (!center) return null
  return (
    <Tooltip content={t('notification.center.title')} asChild>
      <Button
        variant="ghost"
        size="icon"
        data-notification-trigger
        className={`relative size-8 text-muted-foreground ${className}`}
        aria-label={t('notification.center.title')}
        aria-expanded={center.open}
        aria-controls="notification-center"
        onClick={center.toggle}>
        <Bell className="size-4" />
        {center.hasUnread && (
          <span className="absolute right-1 top-1 size-1.5 rounded-full bg-primary">
            <span className="sr-only">{t('notification.center.unread')}</span>
          </span>
        )}
      </Button>
    </Tooltip>
  )
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const returnFocus = useRef(false)
  const { data: unread, refetch } = useQuery('/notifications/unread-count')
  const { trigger: markAllRead, isLoading: markingAllRead } = useMutation('POST', '/notifications/read-all', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  useDataChange('/notifications/unread-count', () => {
    void refetch()
  })
  useIpcOn('notification.open', ({ id }) => {
    setRequestedId(id)
    setOpen(true)
  })
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (!value) setRequestedId(null)
  }
  return (
    <NotificationCenterContext value={{ open, hasUnread: (unread?.count ?? 0) > 0, toggle: () => changeOpen(!open) }}>
      {children}
      <Drawer open={open} onOpenChange={changeOpen} direction="left" modal={false}>
        <DrawerContent
          id="notification-center"
          showOverlay={false}
          style={{
            left: 'var(--notification-left, 0px)',
            top: 'max(44px, env(titlebar-area-height, 0px))',
            bottom: 0,
            width: 'min(384px, calc(100vw - var(--notification-left, 0px)))',
            maxWidth: 'none'
          }}
          className="bg-popover text-popover-foreground shadow-lg motion-reduce:transition-none motion-reduce:animate-none"
          onEscapeKeyDown={() => {
            returnFocus.current = true
          }}
          onPointerDownOutside={(event) => {
            if (event.target instanceof Element && event.target.closest('[data-notification-trigger]'))
              event.preventDefault()
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault()
            if (returnFocus.current) {
              Array.from(document.querySelectorAll<HTMLButtonElement>('[data-notification-trigger]'))
                .find((button) => button.getClientRects().length > 0)
                ?.focus()
              returnFocus.current = false
            }
          }}>
          <div className="flex shrink-0 items-center gap-2 px-4 py-3">
            <DrawerTitle className="mr-auto text-sm font-medium">{t('notification.center.title')}</DrawerTitle>
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
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('common.close')}
              onClick={(event) => {
                returnFocus.current = event.detail === 0
                changeOpen(false)
              }}>
              <X className="size-4" />
            </Button>
          </div>
          <Scrollbar className="min-h-0 flex-1 px-2">
            <NotificationList
              requestedId={requestedId}
              onNavigate={() => changeOpen(false)}
              onDismissRequested={() => setRequestedId(null)}
            />
          </Scrollbar>
          <DrawerDescription className="shrink-0 border-t border-border-subtle px-4 py-2 text-xs">
            {t('notification.center.retention')}
          </DrawerDescription>
        </DrawerContent>
      </Drawer>
    </NotificationCenterContext>
  )
}
