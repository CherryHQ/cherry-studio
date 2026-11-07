import { Bell, CalendarClock, Check, ChevronRight } from 'lucide-react'
import { createContext, lazy, Suspense, use, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Drawer, DrawerContent, DrawerTitle, ScrollArea } from '@cherrystudio/ui'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import type { NotificationRecord } from '@shared/data/types/notification'

import NotificationAnnouncement from './NotificationAnnouncement'
import { notificationCategoryIcons, notificationPreview } from './notificationPresentation'
import { NotificationTaskIdentity } from './NotificationTaskIdentity'
import { NotificationTitle } from './NotificationTitle'

const logger = loggerService.withContext('NotificationCenter')
const ReleaseNotes = lazy(() => import('./ReleaseNotes').then((module) => ({ default: module.ReleaseNotes })))
type DrawerSide = 'left' | 'right'
const NotificationCenterContext = createContext<{
  open: boolean
  hasUnread: boolean
  toggle: (side: DrawerSide) => void
} | null>(null)

const visibleTrigger = () =>
  Array.from(
    document.querySelectorAll<HTMLButtonElement>('[data-notification-anchor], [data-notification-trigger]')
  ).find((button) => button.getClientRects().length > 0)

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
  const unreadDescriptionId = useId()
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
  const Icon = record.target?.kind === 'scheduled-task' ? CalendarClock : notificationCategoryIcons[record.category]
  const task =
    record.target?.kind === 'scheduled-task' ||
    (record.target?.kind === 'conversation' &&
      (record.kind === 'task-completion' || record.kind === 'queue-completion' || !!record.target.result))
  const resultStatus = record.target?.result?.status ?? 'succeeded'
  const replyPreview =
    (record.target?.kind === 'conversation' ? record.target.replyPreview : undefined) ??
    (record.kind === 'task-completion' || record.kind === 'queue-completion'
      ? record.message.split('\n').slice(1).join('\n').trim()
      : record.message.trim())
  const showReplyPreview =
    task && record.target?.kind === 'conversation' && resultStatus === 'succeeded' && !!replyPreview
  const resultLabels = {
    succeeded: t('notification.center.result.succeeded'),
    failed: t('notification.center.result.failed'),
    cancelled: t('notification.center.result.cancelled'),
    interrupted: t('notification.center.result.interrupted')
  }
  const created = new Date(record.createdAt)
  const timeLabel = created.toLocaleString(i18n.language, {
    ...(created.toDateString() === new Date().toDateString() ? {} : { dateStyle: 'short' as const }),
    timeStyle: 'short'
  })
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
    <li data-requested={initiallyExpanded} className="group border-b border-border-subtle last:border-0">
      <div className="relative py-2">
        <Button
          variant="ghost"
          aria-label={task ? undefined : record.title}
          aria-describedby={record.readAt === null ? unreadDescriptionId : undefined}
          aria-expanded={expandable ? expanded : undefined}
          className="block h-auto w-full min-w-0 whitespace-normal px-2 py-2 text-left group-hover:bg-accent group-focus-within:bg-accent"
          disabled={activating}
          onClick={() => void activate()}>
          <span
            className={`mb-1 flex min-h-5 min-w-0 items-center gap-2 pr-8 ${record.readAt === null ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}`}>
            {task ? (
              <NotificationTaskIdentity record={record} />
            ) : (
              <span className="min-w-0 flex-1 truncate">
                <NotificationTitle record={record} />
              </span>
            )}
            {record.readAt === null && (
              <span id={unreadDescriptionId} aria-hidden="true" className="sr-only">
                {t('notification.center.unread')}
              </span>
            )}
          </span>
          <span className="block">
            {task ? (
              <span
                className={
                  resultStatus === 'failed' || resultStatus === 'interrupted'
                    ? 'block text-sm text-error'
                    : 'block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground'
                }>
                {showReplyPreview ? notificationPreview(replyPreview) : resultLabels[resultStatus]}
              </span>
            ) : announcement ? (
              <NotificationAnnouncement id={record.id} announcement={announcement} expanded={expanded} />
            ) : (
              <span className="block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground">
                {notificationPreview(record.message)}
              </span>
            )}
            <span className="mt-1 flex min-h-4 items-center justify-between gap-2 text-foreground-tertiary">
              <time
                dateTime={created.toISOString()}
                aria-label={created.toLocaleString(i18n.language, { dateStyle: 'full', timeStyle: 'long' })}
                className="text-xs text-muted-foreground">
                {timeLabel}
              </time>
              {(!task || record.target?.kind === 'scheduled-task') && (
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
              )}
            </span>
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className="absolute right-1 top-3 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
          aria-label={t('notification.center.dismiss')}
          disabled={dismissing}
          onClick={() =>
            void dismiss()
              .then(onDismiss)
              .catch((error) => {
                logger.error('Failed to dismiss notification', error as Error)
                toast.error(t('notification.center.error'))
              })
          }>
          <Check className="lucide-custom size-4 text-foreground-tertiary" />
        </Button>
      </div>
      {expanded && (release || announcementUrl) && (
        <div className="space-y-3 px-2 pb-4">
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

export function useNotificationCenter() {
  return use(NotificationCenterContext)
}

export function NotificationCenterButton({
  onRequestClose,
  drawerSide = 'left'
}: {
  onRequestClose?: () => void
  drawerSide?: DrawerSide
}) {
  const { t } = useTranslation()
  const unreadDescriptionId = useId()
  const center = useNotificationCenter()
  if (!center) return null
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      data-notification-trigger={drawerSide}
      className="h-8 min-h-8 w-full justify-start gap-2 rounded-md bg-transparent px-2 py-0 text-[13px] text-foreground leading-5"
      aria-label={t('settings.notification.title')}
      aria-describedby={center.hasUnread ? unreadDescriptionId : undefined}
      aria-expanded={center.open}
      aria-controls="notification-center"
      onClick={() => {
        center.toggle(drawerSide)
        onRequestClose?.()
      }}>
      <Bell className="!text-muted-foreground size-4" aria-hidden="true" />
      <span className="min-w-0 flex-1 text-left">{t('settings.notification.title')}</span>
      {center.hasUnread && (
        <span className="size-1.5 shrink-0 rounded-full bg-destructive">
          <span id={unreadDescriptionId} className="sr-only" aria-hidden="true">
            {t('notification.center.unread')}
          </span>
        </span>
      )}
      <span className="shrink-0 text-muted-foreground">
        <ChevronRight className="size-4" aria-hidden="true" />
      </span>
    </Button>
  )
}

export function NotificationCenterProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<DrawerSide>('left')
  const [requestedId, setRequestedId] = useState<string | null>(null)
  const returnFocus = useRef(false)
  const [portalContainer, setPortalContainer] = useState<HTMLDivElement | null>(null)
  const { data: unread, refetch } = useQuery('/notifications/unread-count')
  const { trigger: markAllRead, isLoading: markingAllRead } = useMutation('POST', '/notifications/read-all', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  useDataChange('/notifications/unread-count', () => {
    void refetch()
  })
  useIpcOn('notification.open', ({ id }) => {
    setRequestedId(id)
    setSide(
      (visibleTrigger()?.dataset.notificationAnchor ?? visibleTrigger()?.dataset.notificationTrigger) === 'right'
        ? 'right'
        : 'left'
    )
    setOpen(true)
  })
  const changeOpen = (value: boolean) => {
    setOpen(value)
    if (!value) setRequestedId(null)
  }
  const tabs = useOptionalTabsContext()
  const page = `${tabs?.activeTabId}:${tabs?.tabs.find((tab) => tab.id === tabs.activeTabId)?.url}`
  const [openedPage, setOpenedPage] = useState(page)
  if (page !== openedPage) {
    setOpenedPage(page)
    if (open) changeOpen(false)
  }
  return (
    <NotificationCenterContext
      value={{
        open,
        hasUnread: (unread?.count ?? 0) > 0,
        toggle: (nextSide) => {
          setSide(nextSide)
          changeOpen(!open)
        }
      }}>
      {children}
      <div
        ref={setPortalContainer}
        data-notification-viewport
        className="pointer-events-none fixed z-50 overflow-hidden rounded-[12px]"
        style={{
          left: 'var(--notification-left, 0px)',
          top: 'max(44px, env(titlebar-area-height, 0px))',
          bottom: '6px',
          right: '6px'
        }}
      />
      <Drawer open={open} onOpenChange={changeOpen} direction={side} modal={false}>
        <DrawerContent
          id="notification-center"
          aria-describedby={undefined}
          showOverlay={false}
          portalContainer={portalContainer}
          style={{
            [side]: 0,
            top: 0,
            bottom: 0,
            width: 'min(384px, 100%)',
            maxWidth: 'none'
          }}
          className="pointer-events-auto absolute overflow-hidden rounded-[12px] border-[0.5px] border-border bg-popover text-popover-foreground shadow-lg motion-reduce:transition-none motion-reduce:animate-none"
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
              visibleTrigger()?.focus()
              returnFocus.current = false
            }
          }}>
          <div className="flex shrink-0 items-center gap-2 px-6 pt-3 pb-1">
            <DrawerTitle className="mr-auto text-sm font-medium">{t('notification.center.title')}</DrawerTitle>
            <Button
              variant="ghost"
              size="sm"
              className="px-0"
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
          <ScrollArea className="min-h-0 flex-1 px-4">
            <NotificationList
              requestedId={requestedId}
              onNavigate={() => changeOpen(false)}
              onDismissRequested={() => setRequestedId(null)}
            />
          </ScrollArea>
        </DrawerContent>
      </Drawer>
    </NotificationCenterContext>
  )
}
