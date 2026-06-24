import { usePreference } from '@data/hooks/usePreference'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import {
  getRequiredSidebarIconsVisible,
  getSidebarMenuPath,
  REQUIRED_SIDEBAR_ICONS,
  sanitizeSidebarIcons,
  SIDEBAR_ICON_COMPONENTS,
  SIDEBAR_ICON_ORDER
} from '@renderer/config/sidebar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useSettings } from '@renderer/hooks/useSettings'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import type { SidebarFavorite, SidebarIcon } from '@shared/data/preference/preferenceTypes'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'

const REQUIRED_SIDEBAR_ICON_SET = new Set<SidebarIcon>(REQUIRED_SIDEBAR_ICONS)

const APP_ICON_BACKGROUNDS: Record<SidebarIcon, string> = {
  assistants: 'linear-gradient(135deg, #111827, #4B5563)',
  agents: 'linear-gradient(135deg, #2563EB, #38BDF8)',
  store: 'linear-gradient(135deg, #0EA5E9, #6366F1)',
  paintings: 'linear-gradient(135deg, #EC4899, #F472B6)',
  translate: 'linear-gradient(135deg, #06B6D4, #0EA5E9)',
  mini_app: 'linear-gradient(135deg, #8B5CF6, #A855F7)',
  knowledge: 'linear-gradient(135deg, #10B981, #34D399)',
  files: 'linear-gradient(135deg, #F59E0B, #FBBF24)',
  code_tools: 'linear-gradient(135deg, #1F2937, #374151)',
  notes: 'linear-gradient(135deg, #F97316, #FB923C)',
  openclaw: 'linear-gradient(135deg, #EF4444, #B91C1C)'
}

function insertSidebarIconByCanonicalOrder(favorites: SidebarIcon[], icon: SidebarIcon) {
  const iconOrder = SIDEBAR_ICON_ORDER.indexOf(icon)
  const insertIndex = favorites.findIndex((favorite) => SIDEBAR_ICON_ORDER.indexOf(favorite) > iconOrder)
  favorites.splice(insertIndex === -1 ? favorites.length : insertIndex, 0, icon)
}

function getSidebarFavoritesWithPinnedState({
  favorites,
  icon,
  pinned
}: {
  favorites: readonly SidebarIcon[] | undefined
  icon: SidebarIcon
  pinned: boolean
}): SidebarIcon[] {
  const nextFavorites = sanitizeSidebarIcons(favorites).filter((favorite) => favorite !== icon)

  for (const requiredIcon of REQUIRED_SIDEBAR_ICONS) {
    if (!nextFavorites.includes(requiredIcon)) {
      insertSidebarIconByCanonicalOrder(nextFavorites, requiredIcon)
    }
  }

  if (pinned && !nextFavorites.includes(icon)) {
    nextFavorites.push(icon)
  }

  return nextFavorites
}

export default function LaunchpadPage() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { defaultPaintingProvider } = useSettings()
  const { pinned, openedKeepAliveMiniApps } = useMiniApps()
  const [sidebarFavorites, setSidebarFavorites] = usePreference('ui.sidebar.favorites')

  const visibleSidebarIconSet = useMemo(
    () => new Set(getRequiredSidebarIconsVisible(sidebarFavorites)),
    [sidebarFavorites]
  )

  const navigateToUrl = useCallback(
    (url: string) => {
      const parsedUrl = new URL(url, BASE_URL)
      if (parsedUrl.search) {
        return navigate({
          to: parsedUrl.pathname,
          search: Object.fromEntries(parsedUrl.searchParams.entries())
        })
      }

      return navigate({ to: parsedUrl.pathname })
    },
    [navigate]
  )

  const openLaunchpadItem = (icon: SidebarFavorite) => {
    // Launchpad opens each app at its base entry (chat → new conversation,
    // agents → new session). Resuming the last-used instance is the sidebar's
    // job, not the launcher's.
    const path = getSidebarMenuPath(icon, defaultPaintingProvider)
    if (!path) return
    void navigateToUrl(path)
  }

  const openMiniApp = (app: MiniAppType) => {
    void navigateToUrl(`/app/mini-app/${app.appId}`)
  }

  const saveSidebarFavoritePinnedState = useCallback(
    (icon: SidebarIcon, pinned: boolean) => {
      void setSidebarFavorites(
        getSidebarFavoritesWithPinnedState({
          favorites: sidebarFavorites,
          icon,
          pinned
        })
      ).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [setSidebarFavorites, sidebarFavorites, t]
  )

  const pinToSidebar = useCallback(
    (icon: SidebarIcon) => {
      if (visibleSidebarIconSet.has(icon)) return
      saveSidebarFavoritePinnedState(icon, true)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarIconSet]
  )

  const unpinFromSidebar = useCallback(
    (icon: SidebarIcon) => {
      if (!visibleSidebarIconSet.has(icon) || REQUIRED_SIDEBAR_ICON_SET.has(icon)) return
      saveSidebarFavoritePinnedState(icon, false)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarIconSet]
  )

  const getAppContextMenuItems = useCallback(
    (icon: SidebarIcon): CommandContextMenuExtraItem[] => {
      const isPinned = visibleSidebarIconSet.has(icon)

      return [
        {
          type: 'item',
          id: `launchpad.${isPinned ? 'unpin-from-sidebar' : 'pin-to-sidebar'}.${icon}`,
          label: t(isPinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar'),
          enabled: !isPinned || !REQUIRED_SIDEBAR_ICON_SET.has(icon),
          onSelect: () => (isPinned ? unpinFromSidebar(icon) : pinToSidebar(icon))
        }
      ]
    },
    [pinToSidebar, t, unpinFromSidebar, visibleSidebarIconSet]
  )

  const appMenuItems = SIDEBAR_ICON_ORDER.flatMap((icon) => {
    const Icon = SIDEBAR_ICON_COMPONENTS[icon]
    if (!Icon || !getSidebarMenuPath(icon, defaultPaintingProvider)) return []

    return [
      {
        id: icon,
        icon: <Icon size={32} />,
        text: t(getSidebarIconLabelKey(icon)),
        bgColor: APP_ICON_BACKGROUNDS[icon],
        menuItems: getAppContextMenuItems(icon)
      }
    ]
  })

  const sortedMiniApps = useMemo(() => {
    const result = [...pinned]

    openedKeepAliveMiniApps.forEach((app) => {
      if (!result.some((pinnedApp) => pinnedApp.appId === app.appId)) {
        result.push(app)
      }
    })

    return result
  }, [openedKeepAliveMiniApps, pinned])

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <Scrollbar className="min-h-0 flex-1">
        <div className="mx-auto flex w-full max-w-180 flex-col gap-5 py-12.5">
          <section className="flex flex-col gap-2">
            <h2 className="m-0 px-9 py-0 font-semibold text-[14px] text-foreground opacity-80">
              {t('launchpad.apps')}
            </h2>
            <div className="grid grid-cols-6 gap-2 px-2">
              {appMenuItems.map((item) => (
                <CommandContextMenu key={item.id} location="webcontents.context" extraItems={item.menuItems}>
                  <button
                    type="button"
                    onClick={() => openLaunchpadItem(item.id)}
                    className="group flex cursor-pointer flex-col items-center gap-1 rounded-2xl px-1 py-2 text-center outline-none transition-transform duration-200 hover:scale-105 focus-visible:scale-105 active:scale-95">
                    <span className="relative flex size-14 items-center justify-center">
                      <span
                        className="flex size-14 items-center justify-center rounded-2xl text-white shadow-sm [&_svg]:size-7 [&_svg]:text-white"
                        style={{ background: item.bgColor }}>
                        {item.icon}
                      </span>
                    </span>
                    <span className="w-full overflow-hidden text-ellipsis whitespace-nowrap text-[12px] text-foreground">
                      {item.text}
                    </span>
                  </button>
                </CommandContextMenu>
              ))}
            </div>
          </section>

          {sortedMiniApps.length > 0 && (
            <section className="flex flex-col gap-2">
              <h2 className="m-0 px-9 py-0 font-semibold text-[14px] text-foreground opacity-80">
                {t('launchpad.miniApps')}
              </h2>
              <div className="grid grid-cols-6 gap-2 px-2">
                {sortedMiniApps.map((app) => (
                  <div
                    key={app.appId}
                    className="rounded-[8px] px-1 py-2 transition-transform duration-200 hover:scale-105 active:scale-95">
                    <App app={app} size={56} variant="launchpad" onOpen={openMiniApp} />
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </Scrollbar>
    </div>
  )
}
