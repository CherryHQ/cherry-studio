import { usePreference } from '@data/hooks/usePreference'
import { SIDEBAR_ICON_COMPONENTS } from '@renderer/components/app/sidebarIcons'
import { CommandContextMenu, type CommandContextMenuExtraItem } from '@renderer/components/command'
import App from '@renderer/components/MiniApp/MiniApp'
import Scrollbar from '@renderer/components/Scrollbar'
import { useMiniApps } from '@renderer/hooks/useMiniApps'
import { useTheme } from '@renderer/hooks/useTheme'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import {
  getRequiredSidebarFavoritesVisible,
  getSidebarMenuPath,
  REQUIRED_SIDEBAR_FAVORITES,
  sanitizeSidebarFavorites,
  SIDEBAR_FAVORITE_ORDER
} from '@renderer/utils/sidebar'
import { ThemeMode, type SidebarFavorite } from '@shared/data/preference/preferenceTypes'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'

const REQUIRED_SIDEBAR_FAVORITE_SET = new Set<SidebarFavorite>(REQUIRED_SIDEBAR_FAVORITES)

// Flat diagonal multi-hue blend (OpenAI-style) — smooth, no spherical highlight or vignette.
const mesh = (c1: string, c2: string, c3: string) =>
  `linear-gradient(140deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`

// Grayscale film grain (SVG turbulence) layered over the gradient at low opacity + overlay blend.
const NOISE_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix type='saturate' values='0'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")"

// Light: medium core (≈400) with lighter edges — colorful but not too deep. White glyph reads on the core.
const APP_ICON_BACKGROUNDS_LIGHT: Record<SidebarFavorite, string> = {
  assistants: mesh('#BFDBFE', '#60A5FA', '#A5B4FC'),
  agents: mesh('#A5F3FC', '#38BDF8', '#7DD3FC'),
  store: mesh('#99F6E4', '#2DD4BF', '#5EEAD4'),
  paintings: mesh('#FBCFE8', '#F472B6', '#F9A8D4'),
  translate: mesh('#BBF7D0', '#4ADE80', '#86EFAC'),
  mini_app: mesh('#DDD6FE', '#A78BFA', '#C4B5FD'),
  knowledge: mesh('#D9F99D', '#A3E635', '#BEF264'),
  files: mesh('#FDE68A', '#FBBF24', '#FCD34D'),
  code_tools: mesh('#C7D2FE', '#818CF8', '#A5B4FC'),
  notes: mesh('#FED7AA', '#FB923C', '#FDBA74'),
  openclaw: mesh('#FCA5A5', '#F87171', '#FCA5A5')
}

const APP_ICON_BACKGROUNDS_DARK: Record<SidebarFavorite, string> = {
  assistants: mesh('#93C5FD', '#60A5FA', '#A5B4FC'),
  agents: mesh('#67E8F9', '#38BDF8', '#7DD3FC'),
  store: mesh('#5EEAD4', '#2DD4BF', '#6EE7B7'),
  paintings: mesh('#F9A8D4', '#F472B6', '#F0ABFC'),
  translate: mesh('#86EFAC', '#4ADE80', '#BEF264'),
  mini_app: mesh('#C4B5FD', '#A78BFA', '#F0ABFC'),
  knowledge: mesh('#BEF264', '#A3E635', '#6EE7B7'),
  files: mesh('#FCD34D', '#FBBF24', '#FDBA74'),
  code_tools: mesh('#A5B4FC', '#818CF8', '#C4B5FD'),
  notes: mesh('#FDBA74', '#FB923C', '#FCA5A5'),
  openclaw: mesh('#FCA5A5', '#F87171', '#FDBA74')
}

function insertSidebarFavoriteByCanonicalOrder(favorites: SidebarFavorite[], favorite: SidebarFavorite) {
  const favoriteOrder = SIDEBAR_FAVORITE_ORDER.indexOf(favorite)
  const insertIndex = favorites.findIndex((existing) => SIDEBAR_FAVORITE_ORDER.indexOf(existing) > favoriteOrder)
  favorites.splice(insertIndex === -1 ? favorites.length : insertIndex, 0, favorite)
}

function getSidebarFavoritesWithPinnedState({
  favorites,
  favorite,
  pinned
}: {
  favorites: readonly SidebarFavorite[] | undefined
  favorite: SidebarFavorite
  pinned: boolean
}): SidebarFavorite[] {
  const nextFavorites = sanitizeSidebarFavorites(favorites).filter((existing) => existing !== favorite)

  for (const requiredFavorite of REQUIRED_SIDEBAR_FAVORITES) {
    if (!nextFavorites.includes(requiredFavorite)) {
      insertSidebarFavoriteByCanonicalOrder(nextFavorites, requiredFavorite)
    }
  }

  if (pinned && !nextFavorites.includes(favorite)) {
    nextFavorites.push(favorite)
  }

  return nextFavorites
}

export default function LaunchpadPage() {
  const { t } = useTranslation()
  const { theme } = useTheme()
  const navigate = useNavigate()
  const [defaultPaintingProvider] = usePreference('feature.paintings.default_provider')
  const { pinned, openedKeepAliveMiniApps } = useMiniApps()
  const [sidebarFavorites, setSidebarFavorites] = usePreference('ui.sidebar.favorites')

  const visibleSidebarFavoriteSet = useMemo(
    () => new Set(getRequiredSidebarFavoritesVisible(sidebarFavorites)),
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
    (icon: SidebarFavorite, pinned: boolean) => {
      void setSidebarFavorites(
        getSidebarFavoritesWithPinnedState({
          favorites: sidebarFavorites,
          favorite: icon,
          pinned
        })
      ).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [setSidebarFavorites, sidebarFavorites, t]
  )

  const pinToSidebar = useCallback(
    (icon: SidebarFavorite) => {
      if (visibleSidebarFavoriteSet.has(icon)) return
      saveSidebarFavoritePinnedState(icon, true)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarFavoriteSet]
  )

  const unpinFromSidebar = useCallback(
    (icon: SidebarFavorite) => {
      if (!visibleSidebarFavoriteSet.has(icon) || REQUIRED_SIDEBAR_FAVORITE_SET.has(icon)) return
      saveSidebarFavoritePinnedState(icon, false)
    },
    [saveSidebarFavoritePinnedState, visibleSidebarFavoriteSet]
  )

  const getAppContextMenuItems = useCallback(
    (icon: SidebarFavorite): CommandContextMenuExtraItem[] => {
      const isPinned = visibleSidebarFavoriteSet.has(icon)

      return [
        {
          type: 'item',
          id: `launchpad.${isPinned ? 'unpin-from-sidebar' : 'pin-to-sidebar'}.${icon}`,
          label: t(isPinned ? 'launchpad.unpin_from_sidebar' : 'launchpad.pin_to_sidebar'),
          enabled: !isPinned || !REQUIRED_SIDEBAR_FAVORITE_SET.has(icon),
          onSelect: () => (isPinned ? unpinFromSidebar(icon) : pinToSidebar(icon))
        }
      ]
    },
    [pinToSidebar, t, unpinFromSidebar, visibleSidebarFavoriteSet]
  )

  const appIconBackgrounds = theme === ThemeMode.dark ? APP_ICON_BACKGROUNDS_DARK : APP_ICON_BACKGROUNDS_LIGHT

  const appMenuItems = SIDEBAR_FAVORITE_ORDER.flatMap((icon) => {
    const Icon = SIDEBAR_ICON_COMPONENTS[icon]
    if (!Icon || !getSidebarMenuPath(icon, defaultPaintingProvider)) return []

    return [
      {
        id: icon,
        icon: <Icon size={32} />,
        text: t(getSidebarIconLabelKey(icon)),
        bgColor: appIconBackgrounds[icon],
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
                        className="relative flex size-14 items-center justify-center overflow-hidden rounded-2xl text-white shadow-sm [&_svg]:size-7 [&_svg]:text-white"
                        style={{ background: item.bgColor }}>
                        <span
                          aria-hidden
                          className="pointer-events-none absolute inset-0 mix-blend-overlay opacity-[0.18]"
                          style={{ backgroundImage: NOISE_BG }}
                        />
                        <span className="relative z-10 flex">{item.icon}</span>
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
