import { arrayMove } from '@dnd-kit/sortable'
import { CircleOff, LoaderCircle, Plus, Settings, WifiOff } from 'lucide-react'
import type { ReactElement, Ref } from 'react'
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import useSWR from 'swr'

import { Button, Popover, PopoverContent, PopoverTrigger, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { useTabs } from '@renderer/hooks/tab'
import useAvatar from '@renderer/hooks/useAvatar'
import { useCherryAccountSession } from '@renderer/hooks/useCherryAccountSession'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { ipcApi } from '@renderer/ipc'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { getAppEdition } from '@renderer/utils/appEdition'
import { getTabWorkspaceKey } from '@renderer/utils/navigationWorkspace'
import { isMac } from '@renderer/utils/platform'
import { SIDEBAR_SHORTCUT_PROVIDER_IDS, type SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

import { CommandTooltip } from '../command'
import { HelpMenu } from '../layout/HelpMenu'
import { AppUpdateButton } from '../layout/ShellTabBarActions'
import {
  getSidebarDisplayWidth,
  getSidebarLayout,
  normalizeSidebarWidth,
  type ResolvedSidebarEntry,
  type SidebarIconPresentation,
  type SidebarUser,
  type SidebarVisibleLayout,
  Sidebar as UISidebar
} from '../Sidebar'
import { UserAccountPanel } from '../UserAccountPanel'
import {
  useResolvedSidebarShortcuts,
  useSidebarNavigationSnapshot,
  useSidebarShortcutActivation,
  useSidebarShortcutRegistry
} from './sidebarShortcuts'
import { useWorkspaceTaskStatuses, type WorkspaceTaskStatus } from './useWorkspaceTaskStatuses'

const FeedbackDialog = lazy(() => import('../feedback/FeedbackDialog'))

function applyEntryOrder(entries: ResolvedSidebarEntry[], orderedKeys: readonly string[]): ResolvedSidebarEntry[] {
  const byKey = new Map(entries.map((entry) => [entry.key, entry]))
  const optimisticKeys = new Set(orderedKeys)
  return [
    ...orderedKeys.flatMap((key) => {
      const entry = byKey.get(key)
      return entry ? [entry] : []
    }),
    ...entries.filter((entry) => !optimisticKeys.has(entry.key))
  ]
}

function getWorkspaceStatusLabel(status: WorkspaceTaskStatus, t: (key: string) => string): string | undefined {
  if (status === 'idle') return undefined
  if (status === 'action-required') return t('agent.toolPermission.pendingBadge')
  if (status === 'error') return t('message.tools.status.error')
  if (status === 'running') return t('message.tools.status.running')
  return t('message.tools.status.done')
}

export default function Sidebar({
  ref,
  isFullscreen = false
}: {
  ref?: Ref<HTMLDivElement | null>
  isFullscreen?: boolean
}) {
  const { t } = useTranslation()
  const showUserInFooter = isMac && !isFullscreen
  const [userName] = usePreference('app.user.name')
  const { status: accountStatus } = useCherryAccountSession()
  const accountId = accountStatus?.phase === 'signed-in' ? accountStatus.accountId : null
  useSWR(
    getAppEdition() === 'global' && accountId ? ['cherry-cloud/account-plans', accountId] : null,
    () => ipcApi.request('cherry_cloud.account_plans.get'),
    { shouldRetryOnError: false }
  )
  const { shortcuts, remove, reorder } = useSidebarShortcuts()
  const registry = useSidebarShortcutRegistry()
  const resolutions = useResolvedSidebarShortcuts(shortcuts, registry)
  const activateShortcut = useSidebarShortcutActivation()
  const navigation = useSidebarNavigationSnapshot()
  const { activateWorkspace, closeWorkspace, navigationLayout, tabs, updateTab } = useTabs()
  const workspaceTaskStatuses = useWorkspaceTaskStatuses(navigationLayout === 'sidebar')

  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState<number | null>(null)
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
  const userMenuOpenedByPointerRef = useRef(false)
  const [hoverVisible, setHoverVisible] = useState(false)
  const activeSidebarWidth = previewSidebarWidth ?? sidebarWidth
  const layout = getSidebarLayout(activeSidebarWidth)

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${getSidebarDisplayWidth(activeSidebarWidth)}px`)
  }, [activeSidebarWidth])

  useEffect(() => {
    if (previewSidebarWidth !== null) return
    const normalizedWidth = normalizeSidebarWidth(sidebarWidth)
    if (normalizedWidth !== sidebarWidth) setSidebarWidth(normalizedWidth)
  }, [previewSidebarWidth, setSidebarWidth, sidebarWidth])

  useEffect(() => {
    if (navigationLayout !== 'sidebar') return
    for (const tab of tabs) {
      const workspaceKey = getTabWorkspaceKey(tab)
      if (!workspaceKey?.startsWith('app:')) continue
      const status = workspaceTaskStatuses.get(workspaceKey.slice('app:'.length) as SidebarAppId)
      const preventDormancy = status === 'action-required' || status === 'running'
      if (Boolean(tab.metadata?.preventDormancy) === preventDormancy) continue
      updateTab(tab.id, { metadata: { ...tab.metadata, preventDormancy } })
    }
  }, [navigationLayout, tabs, updateTab, workspaceTaskStatuses])

  useEffect(() => {
    if (layout === 'hidden') {
      setUserMenuOpen(false)
      setHoverVisible(false)
    }
  }, [layout])

  const avatar = useAvatar()
  const handleUserMenuOpenChange = useCallback(
    (open: boolean) => {
      setUserMenuOpen(open)
      if (!open && layout === 'hidden') setHoverVisible(false)
    },
    [layout]
  )
  const handleUserMenuToggle = useCallback(
    () => handleUserMenuOpenChange(!userMenuOpen),
    [handleUserMenuOpenChange, userMenuOpen]
  )
  useEffect(() => {
    if (!userMenuOpen) return
    const handleWindowBlur = () => handleUserMenuOpenChange(false)
    window.addEventListener('blur', handleWindowBlur)
    return () => window.removeEventListener('blur', handleWindowBlur)
  }, [handleUserMenuOpenChange, userMenuOpen])

  const sidebarUser = useMemo<SidebarUser>(
    () => ({
      name: userName || t('chat.user', { defaultValue: t('export.user', { defaultValue: 'User' }) }),
      avatar: avatar || undefined,
      onClick: handleUserMenuToggle
    }),
    [avatar, handleUserMenuToggle, t, userName]
  )
  const renderSidebarUserTrigger = useCallback(
    (trigger: ReactElement) => (
      <PopoverTrigger
        asChild
        onPointerDown={() => (userMenuOpenedByPointerRef.current = true)}
        onKeyDown={() => (userMenuOpenedByPointerRef.current = false)}>
        {trigger}
      </PopoverTrigger>
    ),
    []
  )
  const renderUserMenu = () =>
    userMenuOpen ? (
      <PopoverContent
        aria-label={t('sidebar.account_menu')}
        align="start"
        side={showUserInFooter ? 'top' : 'bottom'}
        sideOffset={8}
        className="w-56 rounded-md p-0"
        onOpenAutoFocus={(event) => {
          if (userMenuOpenedByPointerRef.current) event.preventDefault()
        }}
        onClick={(event) => event.stopPropagation()}>
        <UserAccountPanel onRequestClose={() => handleUserMenuOpenChange(false)}>
          <HelpMenu onFeedbackClick={handleOpenFeedback} onRequestClose={() => handleUserMenuOpenChange(false)} />
        </UserAccountPanel>
      </PopoverContent>
    ) : null

  const removeShortcut = useCallback(
    (target: SidebarShortcutTarget) => {
      if (navigationLayout === 'sidebar') {
        if (target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.APP) {
          closeWorkspace(`app:${target.locator.resourceId}`)
        } else if (target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP) {
          closeWorkspace(`mini-app:${target.locator.resourceId}`)
        }
      }
      remove(target)
    },
    [closeWorkspace, navigationLayout, remove]
  )
  const resolvedEntries = useMemo(
    () =>
      resolutions.map((resolution) => {
        const { shortcut } = resolution
        const provider = registry.resolve(shortcut.target)
        const isResolved = resolution.status === 'resolved'
        const label = isResolved
          ? resolution.resource.label
          : shortcut.fallbackLabel || shortcut.target.locator.resourceId
        const renderIcon = isResolved
          ? resolution.resource.renderIcon
          : ({ glyphSize }: SidebarIconPresentation) => {
              const Icon =
                resolution.status === 'loading' ? LoaderCircle : resolution.status === 'missing' ? CircleOff : WifiOff
              return (
                <Icon
                  size={glyphSize}
                  strokeWidth={1.6}
                  className={resolution.status === 'loading' ? 'animate-spin' : undefined}
                />
              )
            }
        const activate = (inNewTab = false) => {
          if (!isResolved || !provider) return
          void activateShortcut(provider, shortcut.target, resolution.resource, inNewTab).catch(() =>
            toast.error(t('common.error'))
          )
        }
        const activateInNewTab =
          navigationLayout !== 'sidebar' && isResolved && provider && resolution.resource.supportsNewTab
            ? () => activate(true)
            : undefined
        const workspaceStatus =
          navigationLayout === 'sidebar' && shortcut.target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.APP
            ? workspaceTaskStatuses.get(shortcut.target.locator.resourceId as SidebarAppId)
            : undefined
        const statusLabel = workspaceStatus ? getWorkspaceStatusLabel(workspaceStatus, t) : undefined

        return {
          key: shortcut.id,
          label,
          renderIcon,
          disabled: !isResolved || !provider,
          isActive: !!provider?.isActive?.(shortcut.target, navigation),
          statusLabel:
            statusLabel ??
            (isResolved
              ? undefined
              : resolution.status === 'loading'
                ? t('common.loading')
                : resolution.status === 'missing'
                  ? t('sidebar.resource_missing')
                  : t('sidebar.resource_unavailable')),
          status:
            workspaceStatus && workspaceStatus !== 'idle'
              ? { value: workspaceStatus, label: statusLabel ?? workspaceStatus }
              : undefined,
          onOpen: () => activate(),
          onOpenNewTab: activateInNewTab,
          contextMenuItems: [
            ...(activateInNewTab
              ? [
                  {
                    type: 'item' as const,
                    id: `sidebar.open-in-new-tab.${shortcut.id}`,
                    label: t('common.open_in_new_tab'),
                    onSelect: activateInNewTab
                  }
                ]
              : []),
            {
              type: 'item' as const,
              id: `sidebar.remove.${shortcut.id}`,
              label: t('launchpad.unpin_from_sidebar'),
              onSelect: () => removeShortcut(shortcut.target)
            }
          ]
        }
      }),
    [activateShortcut, navigation, navigationLayout, registry, removeShortcut, resolutions, t, workspaceTaskStatuses]
  )
  const [entries, setOptimisticEntryOrder] = useOptimistic(resolvedEntries, applyEntryOrder)

  const handleReorder = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      if (oldIndex === newIndex) return
      const byId = new Map(shortcuts.map((shortcut) => [shortcut.id, shortcut]))
      const reorderedEntries = arrayMove(entries, oldIndex, newIndex)
      const reorderedShortcuts = reorderedEntries.flatMap((entry) => {
        const shortcut = byId.get(entry.key)
        return shortcut ? [shortcut] : []
      })
      startTransition(async () => {
        setOptimisticEntryOrder(reorderedEntries.map((entry) => entry.key))
        await reorder(reorderedShortcuts).catch(() => undefined)
      })
    },
    [entries, reorder, setOptimisticEntryOrder, shortcuts]
  )

  const handleOpenLaunchpad = useCallback(
    () => activateWorkspace('launchpad', '/app/launchpad', { title: t('title.launchpad') }),
    [activateWorkspace, t]
  )
  const handleOpenFeedback = useCallback(() => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }, [])

  const renderSettingsButton = (footerLayout: SidebarVisibleLayout) => (
    <CommandTooltip
      command="app.settings.open"
      label={t('settings.title')}
      placement="right"
      delay={800}
      fullWidthTrigger={footerLayout === 'full'}>
      <Button
        variant="ghost"
        size={footerLayout === 'icon' ? 'icon' : 'default'}
        aria-label={t('settings.title')}
        onClick={() => openSettingsTab()}
        className={
          footerLayout === 'icon'
            ? 'shell-navigation-item size-9 rounded-full'
            : 'shell-navigation-item flex w-full min-w-0 items-center justify-start gap-2.5 overflow-hidden rounded-full px-2.5 py-1.75 text-[13px]'
        }>
        <Settings className={footerLayout === 'icon' ? 'size-4.5' : 'size-4'} strokeWidth={1.6} />
        {footerLayout === 'full' && <span className="min-w-0 truncate">{t('settings.title')}</span>}
      </Button>
    </CommandTooltip>
  )

  const sidebarProps = {
    isFullscreen,
    entries,
    emptyHint: t('sidebar.empty_hint', { launchpad: t('title.launchpad') }),
    user: sidebarUser,
    userAction: (footerLayout: SidebarVisibleLayout) => (
      <>
        {layout === 'full' && <AppUpdateButton placement="top" />}
        {showUserInFooter && footerLayout === 'full' && renderSettingsButton('icon')}
      </>
    ),
    renderUserTrigger: renderSidebarUserTrigger,
    actions: (footerLayout: SidebarVisibleLayout) =>
      showUserInFooter && footerLayout === 'full' ? null : renderSettingsButton(footerLayout),
    fixedAction:
      navigationLayout === 'sidebar'
        ? (fixedActionLayout: SidebarVisibleLayout) =>
            fixedActionLayout === 'icon' ? (
              <Tooltip content={t('title.launchpad')} placement="right" delay={600}>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={t('title.launchpad')}
                  onClick={handleOpenLaunchpad}
                  className="size-9 rounded-full text-muted-foreground hover:bg-accent/60 hover:text-foreground">
                  <Plus size={18} strokeWidth={1.6} />
                </Button>
              </Tooltip>
            ) : (
              <Button
                type="button"
                variant="ghost"
                aria-label={t('title.launchpad')}
                onClick={handleOpenLaunchpad}
                className="flex w-full items-center justify-start gap-2.5 rounded-lg px-2.5 py-1.75 text-[13px] text-foreground hover:bg-accent/60 hover:text-foreground">
                <Plus size={16} strokeWidth={1.6} />
                <span>{t('title.launchpad')}</span>
              </Button>
            )
        : undefined,
    onEntriesReorder: handleReorder
  }

  return (
    <div ref={ref} id="app-sidebar" data-ui="app.sidebar" className="relative h-full [-webkit-app-region:no-drag]">
      <Popover open={layout !== 'hidden' && userMenuOpen} onOpenChange={handleUserMenuOpenChange}>
        <UISidebar
          width={activeSidebarWidth}
          setWidth={setSidebarWidth}
          onHoverChange={setHoverVisible}
          onResizePreview={setPreviewSidebarWidth}
          {...sidebarProps}
        />
        {layout !== 'hidden' && renderUserMenu()}
      </Popover>
      {hoverVisible && layout === 'hidden' && (
        <Popover open={userMenuOpen} onOpenChange={handleUserMenuOpenChange}>
          <UISidebar
            width={activeSidebarWidth}
            setWidth={setSidebarWidth}
            isFloating
            onDismiss={() => {
              if (!userMenuOpen) setHoverVisible(false)
            }}
            {...sidebarProps}
          />
          {renderUserMenu()}
        </Popover>
      )}
      {feedbackDialogMounted ? (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
