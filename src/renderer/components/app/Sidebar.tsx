import { arrayMove } from '@dnd-kit/sortable'
import { CircleOff, LoaderCircle, Plus, WifiOff } from 'lucide-react'
import type { Ref } from 'react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { startTransition, useOptimistic } from 'react'
import { useTranslation } from 'react-i18next'

import { Button, Tooltip } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { useTabs } from '@renderer/hooks/tab'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { useWorkspaceTaskStatuses, type WorkspaceTaskStatus } from '@renderer/hooks/useWorkspaceTaskStatuses'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { getTabWorkspaceKey } from '@renderer/utils/navigationWorkspace'
import { SIDEBAR_SHORTCUT_PROVIDER_IDS, type SidebarAppId } from '@renderer/utils/sidebar'
import type { SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

import { SidebarShellActions } from '../layout/ShellTabBarActions'
import {
  getSidebarDisplayWidth,
  getSidebarLayout,
  normalizeSidebarWidth,
  type ResolvedSidebarEntry,
  type SidebarIconPresentation,
  type SidebarUser,
  type SidebarVisibleLayout,
  Sidebar as UISidebar,
  UserAvatar
} from '../Sidebar'
import UserPopup from '../UserPopup'
import {
  useResolvedSidebarShortcuts,
  useSidebarNavigationSnapshot,
  useSidebarShortcutActivation,
  useSidebarShortcutRegistry
} from './sidebarShortcuts'

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
  const [userName] = usePreference('app.user.name')
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
  const activeSidebarWidth = previewSidebarWidth ?? sidebarWidth

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

  const avatar = useAvatar()
  const sidebarUser = useMemo<SidebarUser>(
    () => ({
      name: userName || t('chat.user', { defaultValue: t('export.user', { defaultValue: 'User' }) }),
      avatar: avatar || undefined,
      onClick: () => UserPopup.show()
    }),
    [avatar, t, userName]
  )
  const sidebarLogo = useMemo(
    () => <UserAvatar user={sidebarUser} className="h-full w-full" ring={false} />,
    [sidebarUser]
  )

  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)
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

  const handleOpenSettingsTab = useCallback(() => openSettingsTab(), [])
  const handleOpenLaunchpad = useCallback(
    () => activateWorkspace('launchpad', '/app/launchpad', { title: t('title.launchpad') }),
    [activateWorkspace, t]
  )
  const handleOpenFeedback = useCallback(() => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }, [])

  const sidebarProps = {
    isFullscreen,
    entries,
    title: sidebarUser.name,
    logo: sidebarLogo,
    onHeaderClick: sidebarUser.onClick,
    actions: (footerLayout: SidebarVisibleLayout, onOverlayOpenChange?: (open: boolean) => void) => (
      <SidebarShellActions
        layout={footerLayout}
        onFeedbackClick={handleOpenFeedback}
        onSettingsClick={handleOpenSettingsTab}
        onOverlayOpenChange={onOverlayOpenChange}
      />
    ),
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
      <UISidebar
        width={activeSidebarWidth}
        setWidth={setSidebarWidth}
        onHoverChange={setHoverVisible}
        onResizePreview={setPreviewSidebarWidth}
        {...sidebarProps}
      />
      {hoverVisible && layout === 'hidden' && (
        <UISidebar
          width={activeSidebarWidth}
          setWidth={setSidebarWidth}
          isFloating
          onDismiss={() => setHoverVisible(false)}
          {...sidebarProps}
        />
      )}
      {feedbackDialogMounted ? (
        <Suspense fallback={null}>
          <FeedbackDialog open={feedbackOpen} onOpenChange={setFeedbackOpen} />
        </Suspense>
      ) : null}
    </div>
  )
}
