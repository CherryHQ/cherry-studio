import { arrayMove } from '@dnd-kit/sortable'
import type { Ref } from 'react'
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { usePersistCache } from '@data/hooks/useCache'
import { usePreference } from '@data/hooks/usePreference'
import { useAgents } from '@renderer/hooks/agent/useAgent'
import { useTabs } from '@renderer/hooks/tab'
import { useAssistantsApi } from '@renderer/hooks/useAssistant'
import useAvatar from '@renderer/hooks/useAvatar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSidebarFavorites } from '@renderer/hooks/useSidebarFavorites'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { MINI_APP_ROUTE_PREFIX, miniAppIdFromTabUrl } from '@renderer/utils/miniAppKeepAlive'
import { getDefaultRouteTitle } from '@renderer/utils/routeTitle'
import type { SidebarAppId } from '@renderer/utils/sidebar'
import {
  getSidebarApp,
  getSidebarFavoriteKey,
  getSidebarMenuPath,
  isMessageOnlyConversationUrl,
  resolveSidebarActiveItem,
  tabBelongsToApp
} from '@renderer/utils/sidebar'

import { SidebarShellActions } from '../layout/ShellTabBarActions'
import {
  getSidebarDisplayWidth,
  getSidebarLayout,
  normalizeSidebarWidth,
  Sidebar as UISidebar,
  type SidebarUser,
  type SidebarVisibleLayout,
  UserAvatar
} from '../Sidebar'
import UserPopup from '../UserPopup'
import { resolveSidebarEntry, type SidebarVariantContext } from './sidebarVariants'

const FeedbackDialog = lazy(() => import('../feedback/FeedbackDialog'))

export default function Sidebar({ ref }: { ref?: Ref<HTMLDivElement | null> }) {
  const { t } = useTranslation()
  const [userName] = usePreference('app.user.name')
  const {
    favorites,
    appFavorites,
    miniAppFavoriteIds,
    agentFavoriteIds,
    assistantFavoriteIds,
    setAppPinned,
    removeMiniApp,
    removeAgent,
    removeAssistant,
    reorderFavorites
  } = useSidebarFavorites()
  const { activeTab, tabs, updateTab, openTab, setActiveTab } = useTabs()
  const { miniApps, pinned } = useMiniApps({ enabled: miniAppFavoriteIds.length > 0 })
  const { agents } = useAgents({ enabled: agentFavoriteIds.length > 0 })
  const { assistants } = useAssistantsApi({ enabled: assistantFavoriteIds.length > 0 })
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  // Pinned entity rows render through the same icon renderers as their rails, so they
  // follow the same icon-type preferences instead of always showing the emoji.
  const [assistantIconType] = usePreference('assistant.icon_type')
  const [agentIconType] = usePreference('agent.icon_type')
  const [defaultModelId] = usePreference('chat.default_model_id')

  const installedAgents = useMemo(() => new Map(agents.map((agent) => [agent.id, agent])), [agents])
  const installedAssistants = useMemo(
    () => new Map(assistants.map((assistant) => [assistant.id, assistant])),
    [assistants]
  )

  // Sidebar width — persisted across restarts. Dragging through the
  // intermediate 50-120px range uses a local preview width so the UI can
  // follow the cursor without persisting unstable widths.
  const [sidebarWidth, setSidebarWidth] = usePersistCache('ui.sidebar.width')
  const [previewSidebarWidth, setPreviewSidebarWidth] = useState<number | null>(null)
  const [feedbackDialogMounted, setFeedbackDialogMounted] = useState(false)
  const [feedbackOpen, setFeedbackOpen] = useState(false)
  const activeSidebarWidth = previewSidebarWidth ?? sidebarWidth

  useLayoutEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${getSidebarDisplayWidth(activeSidebarWidth)}px`)
  }, [activeSidebarWidth])

  // Migration, not dead code: the resize path only persists normalized widths,
  // but older builds (three-state layout, default 65) persisted intermediate
  // values that must be collapsed once on load. Writing derived state back
  // cannot loop — normalizeSidebarWidth is idempotent and the write is guarded
  // by the inequality check. Skip while a drag preview is active so the
  // write-back does not clobber it.
  useEffect(() => {
    if (previewSidebarWidth !== null) return

    const normalizedWidth = normalizeSidebarWidth(sidebarWidth)
    if (normalizedWidth !== sidebarWidth) {
      setSidebarWidth(normalizedWidth)
    }
  }, [previewSidebarWidth, setSidebarWidth, sidebarWidth])

  // User avatar
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

  // Floating sidebar (hover reveal when hidden)
  const [hoverVisible, setHoverVisible] = useState(false)
  const layout = getSidebarLayout(activeSidebarWidth)

  // Menu items
  const pathname = activeTab?.url || '/'
  const activeMiniAppId = miniAppIdFromTabUrl(activeTab?.url) ?? undefined
  const openableMiniAppById = useMemo(() => {
    const appById = new Map<string, (typeof miniApps)[number]>()
    for (const app of miniApps) {
      appById.set(app.appId, app)
    }
    for (const app of pinned) {
      appById.set(app.appId, app)
    }
    return appById
  }, [miniApps, pinned])

  const handleRemoveSidebarFavorite = useCallback(
    (favorite: SidebarAppId) => {
      setAppPinned(favorite, false)
    },
    [setAppPinned]
  )

  const activeItem = resolveSidebarActiveItem(pathname)

  const navigateRouteTab = useCallback(
    (path: string, title: string, options?: { inNewTab?: boolean; icon?: string }) => {
      if (options?.inNewTab) {
        openTab(path, { forceNew: true, title, icon: options.icon })
        return
      }

      if (activeTab?.url === path) return

      if (activeTab?.isPinned) {
        openTab(path, { forceNew: true, title, icon: options?.icon })
        return
      }

      if (activeTab) {
        updateTab(activeTab.id, {
          url: path,
          title,
          icon: options?.icon,
          metadata: undefined
        })
        return
      }

      openTab(path, { forceNew: true, title, icon: options?.icon })
    },
    [activeTab, openTab, updateTab]
  )

  const handleNavigate = useCallback(
    (menuItemId: string, options?: { inNewTab?: boolean }) => {
      const menuId = menuItemId as SidebarAppId
      const app = getSidebarApp(menuId)
      const path = getSidebarMenuPath(menuId, defaultPaintingProvider)
      if (!app || !path) return

      if (!options?.inNewTab) {
        // Conversation apps: any owned tab is already "there" — its URL carries its own
        // conversation, and re-entering through the route interceptor would just rebind
        // it. Message-only viewers are not an app entry, so they navigate like any
        // foreign tab. Apps without sub-instances keep exact-URL matching.
        const isActiveTarget =
          !!activeTab &&
          (app.conversationRoute
            ? tabBelongsToApp(app, activeTab.url) && !isMessageOnlyConversationUrl(activeTab.url)
            : activeTab.url === path)
        if (isActiveTarget) return
      }

      navigateRouteTab(path, getDefaultRouteTitle(path), options)
    },
    [activeTab, defaultPaintingProvider, navigateRouteTab]
  )
  const handleOpenLaunchpad = useCallback(() => {
    openTab('/app/launchpad', { title: getDefaultRouteTitle('/app/launchpad'), forceNew: true })
  }, [openTab])
  const handleOpenSettingsTab = useCallback(() => {
    openSettingsTab()
  }, [])
  const handleOpenFeedback = useCallback(() => {
    setFeedbackDialogMounted(true)
    setFeedbackOpen(true)
  }, [])

  const handleOpenMiniAppTab = useCallback(
    (appId: string, options?: { inNewTab?: boolean }) => {
      const app = openableMiniAppById.get(appId)
      if (!app) return

      const path = `${MINI_APP_ROUTE_PREFIX}${app.appId}`
      const title = app.nameKey ? t(app.nameKey) : app.name
      // Uploaded logo → main-resolved `logoSrc`; preset key → `logo`.
      const icon = app.logoSrc ?? app.logo
      if (options?.inNewTab) {
        navigateRouteTab(path, title, { ...options, icon })
        return
      }

      if (activeTab?.url === path) return

      const existingTab = tabs.find((tab) => tab.type === 'route' && tab.url === path)
      if (existingTab) {
        setActiveTab(existingTab.id)
        return
      }

      navigateRouteTab(path, title, { ...options, icon })
    },
    [activeTab, navigateRouteTab, openableMiniAppById, setActiveTab, t, tabs]
  )

  // Pinned entities reuse tabs like mini apps do; the route interceptor turns the
  // `agentId` / `assistantId` param into that entity's most recent conversation.
  const handleOpenAgentTab = useCallback(
    (agentId: string, options?: { inNewTab?: boolean }) => {
      const agent = installedAgents.get(agentId)
      if (!agent) return
      navigateRouteTab(`/app/agents?agentId=${encodeURIComponent(agentId)}`, agent.name, options)
    },
    [installedAgents, navigateRouteTab]
  )
  const handleOpenAssistantTab = useCallback(
    (assistantId: string, options?: { inNewTab?: boolean }) => {
      const assistant = installedAssistants.get(assistantId)
      if (!assistant) return
      navigateRouteTab(`/app/chat?assistantId=${encodeURIComponent(assistantId)}`, assistant.name, options)
    },
    [installedAssistants, navigateRouteTab]
  )

  // All per-type sidebar knowledge (icon, label, route, active-match, open, remove)
  // lives in the variant registry; the container only supplies the runtime context.
  const variantContext = useMemo<SidebarVariantContext>(
    () => ({
      t,
      defaultPaintingProvider,
      installedMiniApps: openableMiniAppById,
      installedAgents,
      installedAssistants,
      assistantIconType,
      agentIconType,
      defaultModelId,
      visibleAppCount: appFavorites.length,
      openApp: handleNavigate,
      openMiniApp: handleOpenMiniAppTab,
      openAgent: handleOpenAgentTab,
      openAssistant: handleOpenAssistantTab,
      removeApp: handleRemoveSidebarFavorite,
      removeMiniApp,
      removeAgent,
      removeAssistant
    }),
    [
      t,
      defaultPaintingProvider,
      openableMiniAppById,
      installedAgents,
      installedAssistants,
      assistantIconType,
      agentIconType,
      defaultModelId,
      appFavorites.length,
      handleNavigate,
      handleOpenMiniAppTab,
      handleOpenAgentTab,
      handleOpenAssistantTab,
      handleRemoveSidebarFavorite,
      removeMiniApp,
      removeAgent,
      removeAssistant
    ]
  )

  // One continuous list: built-in apps and mini apps interleaved in their stored
  // favorites order. Unrenderable rows (no route/icon, or an uninstalled mini app)
  // are dropped here but stay in the preference.
  const entries = useMemo(
    () =>
      favorites.flatMap((favorite) => {
        const entry = resolveSidebarEntry(favorite, variantContext)
        if (!entry) return []

        const newTabItem = entry.onOpenNewTab
          ? [
              {
                type: 'item' as const,
                id: `sidebar.open-in-new-tab.${entry.key}`,
                label: t('common.open_in_new_tab'),
                onSelect: entry.onOpenNewTab
              }
            ]
          : []

        return [
          {
            ...entry,
            contextMenuItems: [
              ...newTabItem,
              ...(entry.contextMenuItems ?? []),
              {
                type: 'item' as const,
                id: `sidebar.manage.${entry.key}`,
                label: t('launchpad.manage_sidebar'),
                onSelect: handleOpenLaunchpad
              }
            ]
          }
        ]
      }),
    [favorites, handleOpenLaunchpad, t, variantContext]
  )

  // A single drag reorders the whole mixed list. arrayMove yields the new entry
  // order; map each entry back to its favorite by key and persist. The sidebar owns
  // its order entirely through `ui.sidebar.favorites` and never touches order keys.
  const handleReorder = useCallback(
    ({ oldIndex, newIndex }: { oldIndex: number; newIndex: number }) => {
      const byKey = new Map(favorites.map((favorite) => [getSidebarFavoriteKey(favorite), favorite]))
      const nextFavorites = arrayMove(entries, oldIndex, newIndex).flatMap((entry) => {
        const favorite = byKey.get(entry.key)
        return favorite ? [favorite] : []
      })
      reorderFavorites(nextFavorites)
    },
    [entries, favorites, reorderFavorites]
  )

  // Common props shared between normal and floating sidebar
  const sidebarProps = {
    entries,
    active: { activeItem, activeTabId: activeMiniAppId },
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
