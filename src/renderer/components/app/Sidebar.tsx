import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { arrayMove } from '@dnd-kit/sortable'
import { useTabs } from '@renderer/hooks/tab'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { isRequiredSidebarShortcut } from '@renderer/utils/sidebar'
import { CircleOff, LoaderCircle, WifiOff } from 'lucide-react'
import type { Ref } from 'react'
import {
  lazy,
  startTransition,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useOptimistic,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { SidebarShellActions } from '../layout/ShellTabBarActions'
import {
  getSidebarDisplayWidth,
  getSidebarLayout,
  normalizeSidebarWidth,
  type ResolvedSidebarEntry,
  Sidebar as UISidebar,
  type SidebarIconPresentation,
  type SidebarUser,
  type SidebarVisibleLayout,
  UserAvatar
} from '../Sidebar'
import UserPopup from '../UserPopup'
import {
  useResolvedSidebarShortcuts,
  useSidebarActivationGateway,
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

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const { shortcuts, remove, reorder } = useSidebarShortcuts()
  const registry = useSidebarShortcutRegistry()
  const resolutions = useResolvedSidebarShortcuts(shortcuts, registry)
  const gateway = useSidebarActivationGateway()
  const { activeTab } = useTabs()

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
    () => (
      <button
        type="button"
        aria-label={sidebarUser.name}
        onClick={sidebarUser.onClick}
        className="flex h-full w-full items-center justify-center rounded-full [-webkit-app-region:no-drag]">
        <UserAvatar user={sidebarUser} className="h-full w-full" ring={false} />
      </button>
    ),
    [sidebarUser]
  )

  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)
  const navigation = useMemo(() => ({ url: activeTab?.url ?? '/' }), [activeTab?.url])
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
        const activate = () => {
          if (!isResolved || !provider) return
          const resourceGateway = {
            ...gateway,
            openWorkspace: (
              destination: Parameters<typeof gateway.openWorkspace>[0],
              options?: Parameters<typeof gateway.openWorkspace>[1]
            ) =>
              gateway.openWorkspace(
                {
                  ...destination,
                  title: resolution.resource.label,
                  icon: resolution.resource.tabIcon ?? destination.icon
                },
                options
              )
          }
          void provider.activate(shortcut.target, resourceGateway)
        }
        const activateInNewTab =
          isResolved && provider && resolution.resource.supportsNewTab
            ? () => {
                const resourceGateway = {
                  ...gateway,
                  openWorkspace: (destination: Parameters<typeof gateway.openWorkspace>[0]) =>
                    gateway.openWorkspace(
                      {
                        ...destination,
                        title: resolution.resource.label,
                        icon: resolution.resource.tabIcon ?? destination.icon
                      },
                      { inNewTab: true }
                    )
                }
                void provider.activate(shortcut.target, resourceGateway)
              }
            : undefined

        return {
          key: shortcut.id,
          label,
          renderIcon,
          disabled: !isResolved || !provider,
          isActive: () => !!provider?.isActive?.(shortcut.target, navigation),
          onOpen: activate,
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
              enabled: !isRequiredSidebarShortcut(shortcut.target),
              onSelect: () => remove(shortcut.target)
            }
          ]
        }
      }),
    [gateway, navigation, registry, remove, resolutions, t]
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
  const handleOpenFeedback = useCallback(() => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }, [])

  const sidebarProps = {
    entries,
    active: { activeItem: '', activeTabId: undefined },
    title: sidebarUser.name,
    logo: sidebarLogo,
    actions: (footerLayout: SidebarVisibleLayout, onOverlayOpenChange?: (open: boolean) => void) => (
      <SidebarShellActions
        layout={footerLayout}
        onFeedbackClick={handleOpenFeedback}
        onSettingsClick={handleOpenSettingsTab}
        onOverlayOpenChange={onOverlayOpenChange}
      />
    ),
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
