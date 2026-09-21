import { arrayMove } from '@dnd-kit/sortable'
import { CircleOff, LoaderCircle, WifiOff } from 'lucide-react'
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
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

import { Popover, PopoverContent, PopoverTrigger } from '@cherrystudio/ui'
import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import useAvatar from '@renderer/hooks/useAvatar'
import { useSidebarShortcuts } from '@renderer/hooks/useSidebarShortcuts'
import { toast } from '@renderer/services/toast'

import { HelpMenu } from '../layout/HelpMenu'
import { AppUpdateButton, SidebarSettingsButton } from '../layout/ShellTabBarActions'
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

  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState<number | null>(null)
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const [userMenuOpen, setUserMenuOpen] = useState(false)
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
  const sidebarUser = useMemo<SidebarUser>(
    () => ({
      name: userName || t('chat.user', { defaultValue: t('export.user', { defaultValue: 'User' }) }),
      avatar: avatar || undefined,
      onClick: handleUserMenuToggle
    }),
    [avatar, handleUserMenuToggle, t, userName]
  )
  const renderSidebarUserTrigger = useCallback(
    (trigger: ReactElement) => <PopoverTrigger asChild>{trigger}</PopoverTrigger>,
    []
  )
  const renderUserMenu = () =>
    userMenuOpen ? (
      <PopoverContent
        aria-label={t('settings.general.user_name.label')}
        align="start"
        side="top"
        sideOffset={8}
        className="w-56 rounded-md p-0"
        onClick={(event) => event.stopPropagation()}>
        <UserAccountPanel active={userMenuOpen} onRequestClose={() => handleUserMenuOpenChange(false)} />
      </PopoverContent>
    ) : null

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
          isResolved && provider && resolution.resource.supportsNewTab ? () => activate(true) : undefined

        return {
          key: shortcut.id,
          label,
          renderIcon,
          disabled: !isResolved || !provider,
          isActive: !!provider?.isActive?.(shortcut.target, navigation),
          statusLabel: isResolved
            ? undefined
            : resolution.status === 'loading'
              ? t('common.loading')
              : resolution.status === 'missing'
                ? t('sidebar.resource_missing')
                : t('sidebar.resource_unavailable'),
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
              onSelect: () => remove(shortcut.target)
            }
          ]
        }
      }),
    [activateShortcut, navigation, registry, remove, resolutions, shortcuts, t]
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

  const handleOpenFeedback = useCallback(() => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }, [])

  const sidebarProps = {
    isFullscreen,
    entries,
    user: sidebarUser,
    userAction: (_footerLayout: SidebarVisibleLayout, onOverlayOpenChange?: (open: boolean) => void) => (
      <>
        <SidebarSettingsButton />
        <HelpMenu layout="icon" onFeedbackClick={handleOpenFeedback} onOverlayOpenChange={onOverlayOpenChange} />
        {layout === 'full' ? <AppUpdateButton placement="top" /> : null}
      </>
    ),
    renderUserTrigger: renderSidebarUserTrigger,
    onEntriesReorder: handleReorder
  }

  return (
    <div ref={ref} id="app-sidebar" data-ui="app.sidebar" className="relative h-full [-webkit-app-region:no-drag]">
      {layout === 'hidden' ? (
        <UISidebar
          width={activeSidebarWidth}
          setWidth={setSidebarWidth}
          onHoverChange={setHoverVisible}
          onResizePreview={setPreviewSidebarWidth}
          {...sidebarProps}
        />
      ) : (
        <Popover open={userMenuOpen} onOpenChange={handleUserMenuOpenChange}>
          <UISidebar
            width={activeSidebarWidth}
            setWidth={setSidebarWidth}
            onHoverChange={setHoverVisible}
            onResizePreview={setPreviewSidebarWidth}
            {...sidebarProps}
          />
          {renderUserMenu()}
        </Popover>
      )}
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
