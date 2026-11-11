import { Bell, BrushCleaning, CalendarClock, Check, CheckCheck, ChevronRight } from 'lucide-react'
import { createContext, lazy, Suspense, use, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Drawer, DrawerContent, DrawerTitle, ScrollArea, Tooltip } from '@cherrystudio/ui'
import { useDataChange, useInfiniteFlatItems, useInfiniteQuery, useMutation, useQuery } from '@data/hooks/useDataApi'
import { loggerService } from '@logger'
import { useOptionalTabsContext } from '@renderer/hooks/tab'
import { useAppUpdateState } from '@renderer/hooks/useAppUpdateState'
import { ipcApi, useIpcOn } from '@renderer/ipc'
import { toast } from '@renderer/services/toast'
import { isWin } from '@renderer/utils/platform'
import type { NotificationRecord } from '@shared/data/types/notification'

import NotificationAnnouncement from './NotificationAnnouncement'
import { notificationCategoryIcons, notificationPreview, RowKeyboardFocusContext } from './notificationPresentation'
import { NotificationTaskIdentity } from './NotificationTaskIdentity'
import { NotificationTitle } from './NotificationTitle'

const logger = loggerService.withContext('NotificationCenter')
const ReleaseNotes = lazy(() => import('./ReleaseNotes').then((module) => ({ default: module.ReleaseNotes })))
type DrawerSide = 'left' | 'right'
const LIST_EDGE_FADE = 40
const LIST_EDGE_MASK =
  'linear-gradient(to bottom, transparent, black var(--fade-top, 0px), black calc(100% - var(--fade-bottom, 0px)), transparent)'
const DISMISS_COLLAPSE_MS = 150

// Writes the fade distances straight to the element: scroll-linked React state would re-render the whole list.
function trackListEdgeFade(viewport: HTMLDivElement | null) {
  if (!viewport) return
  const update = () => {
    const hiddenBelow = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop
    viewport.style.setProperty('--fade-top', `${Math.min(viewport.scrollTop, LIST_EDGE_FADE)}px`)
    viewport.style.setProperty('--fade-bottom', `${Math.min(Math.max(hiddenBelow, 0), LIST_EDGE_FADE)}px`)
  }
  const observer = new ResizeObserver(update)
  observer.observe(viewport)
  if (viewport.firstElementChild) observer.observe(viewport.firstElementChild)
  viewport.addEventListener('scroll', update, { passive: true })
  return () => {
    observer.disconnect()
    viewport.removeEventListener('scroll', update)
  }
}

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
  leaving,
  onNavigate,
  onDismiss
}: {
  record: NotificationRecord
  initiallyExpanded?: boolean
  leaving: boolean
  onNavigate: () => void
  onDismiss: () => void
}) {
  const { t, i18n } = useTranslation()
  const unreadDescriptionId = useId()
  const [expanded, setExpanded] = useState(initiallyExpanded)
  const [activating, setActivating] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const { appUpdateState, checkForUpdate } = useAppUpdateState(async (releaseInfo) => {
    const { default: UpdateDialogPopup } = await import('./UpdateDialogPopup')
    return UpdateDialogPopup.show({ releaseInfo })
  })
  const { trigger: markRead } = useMutation('PATCH', '/notifications/:id', {
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
    <li
      data-requested={initiallyExpanded}
      className={`group grid transition-[grid-template-rows,opacity] duration-150 ease-out motion-reduce:transition-none ${leaving ? 'pointer-events-none grid-rows-[0fr] opacity-0' : 'grid-rows-[1fr]'}`}>
      <div className="min-h-0 overflow-hidden">
        <div className="relative py-1">
          <Button
            variant="ghost"
            aria-label={task ? undefined : record.title}
            aria-describedby={record.readAt === null ? unreadDescriptionId : undefined}
            aria-expanded={expandable ? expanded : undefined}
            className="block h-auto w-full min-w-0 whitespace-normal px-2 py-2 text-left group-hover:bg-accent group-focus-within:bg-accent"
            disabled={activating}
            onFocus={(event) => setKeyboardFocused(event.currentTarget.matches(':focus-visible'))}
            onBlur={() => setKeyboardFocused(false)}
            onClick={() => void activate()}>
            <span
              className={`mb-1 flex min-h-5 min-w-0 items-center gap-2 text-sm ${record.readAt === null ? 'font-semibold text-foreground' : 'font-normal text-muted-foreground'}`}>
              {(!task || record.target?.kind === 'scheduled-task') && (
                <Icon aria-hidden="true" className="size-3.5 shrink-0 text-foreground-tertiary" />
              )}
              <RowKeyboardFocusContext value={keyboardFocused}>
                {task ? (
                  <NotificationTaskIdentity record={record} />
                ) : (
                  <span className="min-w-0 flex-1">
                    <NotificationTitle record={record} tooltip />
                  </span>
                )}
              </RowKeyboardFocusContext>
              {record.readAt === null && (
                <span id={unreadDescriptionId} aria-hidden="true" className="sr-only">
                  {t('notification.center.unread')}
                </span>
              )}
              <time
                dateTime={created.toISOString()}
                aria-label={created.toLocaleString(i18n.language, { dateStyle: 'full', timeStyle: 'long' })}
                className="shrink-0 text-xs font-normal text-muted-foreground group-hover:invisible group-has-[[data-dismiss]:focus-visible]:invisible">
                {timeLabel}
              </time>
            </span>
            <span className="block">
              {task ? (
                <span
                  className={
                    resultStatus === 'failed' || resultStatus === 'interrupted'
                      ? 'block text-sm text-error'
                      : 'block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground'
                  }>
                  {showReplyPreview ? notificationPreview(replyPreview, false, false) : resultLabels[resultStatus]}
                </span>
              ) : announcement ? (
                <NotificationAnnouncement id={record.id} announcement={announcement} expanded={expanded} />
              ) : (
                <span className="block max-h-[2lh] overflow-hidden break-words text-sm text-muted-foreground">
                  {notificationPreview(record.message, false, false)}
                </span>
              )}
            </span>
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            data-dismiss
            className="absolute right-1 top-2 text-muted-foreground opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
            aria-label={t('notification.center.dismiss')}
            onClick={onDismiss}>
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
      </div>
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
  const { trigger: dismiss } = useMutation('DELETE', '/notifications/:id', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  // A dismissed row renders from its snapshot while it collapses, then stays hidden until the refetch drops it.
  const [dismissing, setDismissing] = useState<ReadonlyMap<string, { record: NotificationRecord; collapsed: boolean }>>(
    new Map()
  )
  const setDismissal = (id: string, entry?: { record: NotificationRecord; collapsed: boolean }) =>
    setDismissing((entries) => {
      const next = new Map(entries)
      if (entry) next.set(id, entry)
      else next.delete(id)
      return next
    })
  const dismissItem = (record: NotificationRecord) => {
    const { id } = record
    setDismissal(id, { record, collapsed: false })
    const collapsed = new Promise<void>((resolve) => window.setTimeout(resolve, DISMISS_COLLAPSE_MS)).then(() =>
      setDismissing((entries) => (entries.has(id) ? new Map(entries).set(id, { record, collapsed: true }) : entries))
    )
    void dismiss({ params: { id } })
      .then(() => collapsed)
      .then(() => {
        if (id === requestedId) onDismissRequested()
      })
      .catch((error) => {
        setDismissal(id)
        logger.error('Failed to dismiss notification', error as Error)
        toast.error(t('notification.center.error'))
      })
  }
  const visibleItems = [
    ...(requestedRecord ? [...items.filter((item) => item.id !== requestedId), requestedRecord] : items).filter(
      (item) => !dismissing.has(item.id)
    ),
    ...[...dismissing.values()].filter((entry) => !entry.collapsed).map((entry) => entry.record)
  ].sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id))
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
            leaving={dismissing.has(record.id)}
            onDismiss={() => dismissItem(record)}
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
  const { trigger: markAllRead } = useMutation('POST', '/notifications/read-all', {
    refresh: ['/notifications', '/notifications/unread-count']
  })
  const { trigger: dismissRead } = useMutation('POST', '/notifications/dismiss-read', {
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
          top: isWin ? 'max(44px, env(titlebar-area-height, 0px))' : '44px',
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
            [side]: 6,
            top: 6,
            bottom: 6,
            width: 'min(384px, calc(100% - 12px))',
            maxWidth: 'none'
          }}
          className="pointer-events-auto absolute overflow-hidden rounded-lg border-[0.5px] border-border bg-popover text-popover-foreground shadow-lg motion-reduce:transition-none motion-reduce:animate-none"
          // Focusing the first header button on open would pop its tooltip and swallow the first Escape.
          onOpenAutoFocus={(event) => {
            event.preventDefault()
            if (event.target instanceof HTMLElement) event.target.focus()
          }}
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
          <div className="flex shrink-0 items-center gap-1 px-6 pt-3 pb-1">
            <DrawerTitle className="mr-auto text-sm font-medium">{t('notification.center.title')}</DrawerTitle>
            <Tooltip content={t('notification.center.mark_all_read')} asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground"
                aria-label={t('notification.center.mark_all_read')}
                disabled={!unread?.count}
                onClick={() =>
                  void markAllRead().catch((error) => {
                    logger.error('Failed to mark notifications read', error as Error)
                    toast.error(t('notification.center.error'))
                  })
                }>
                <CheckCheck className="size-4" aria-hidden="true" />
              </Button>
            </Tooltip>
            <Tooltip content={t('notification.center.clear_read')} asChild>
              <Button
                variant="ghost"
                size="icon-sm"
                className="-mr-1.5 text-muted-foreground"
                aria-label={t('notification.center.clear_read')}
                onClick={() =>
                  void dismissRead().catch((error) => {
                    logger.error('Failed to clear read notifications', error as Error)
                    toast.error(t('notification.center.error'))
                  })
                }>
                <BrushCleaning className="size-4" aria-hidden="true" />
              </Button>
            </Tooltip>
          </div>
          <ScrollArea
            className="min-h-0 flex-1 px-4"
            viewportProps={{ ref: trackListEdgeFade, style: { maskImage: LIST_EDGE_MASK } }}>
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
