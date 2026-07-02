import { SegmentedControl } from '@cherrystudio/ui'
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
import { type SidebarFavorite, ThemeMode } from '@shared/data/preference/preferenceTypes'
import type { MiniApp as MiniAppType } from '@shared/data/types/miniApp'
import { useNavigate } from '@tanstack/react-router'
import { useCallback, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

const BASE_URL = 'https://www.cherry-ai.com/'

const REQUIRED_SIDEBAR_FAVORITE_SET = new Set<SidebarFavorite>(REQUIRED_SIDEBAR_FAVORITES)

// Flat diagonal multi-hue blend (OpenAI-style) — smooth, no spherical highlight or vignette.
const mesh = (c1: string, c2: string, c3: string) => `linear-gradient(140deg, ${c1} 0%, ${c2} 50%, ${c3} 100%)`

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

// --- TEMP: design-review-only palette alternates + switcher. Remove this block
// (and the switcher UI below) once the team picks a final palette. ---

// Muted: one Tailwind shade lighter/softer per stop than the baseline above.
const APP_ICON_BACKGROUNDS_LIGHT_MUTED: Record<SidebarFavorite, string> = {
  assistants: mesh('#DBEAFE', '#93C5FD', '#BFDBFE'),
  agents: mesh('#CFFAFE', '#67E8F9', '#BAE6FD'),
  store: mesh('#CCFBF1', '#5EEAD4', '#99F6E4'),
  paintings: mesh('#FCE7F3', '#F9A8D4', '#FBCFE8'),
  translate: mesh('#DCFCE7', '#86EFAC', '#BBF7D0'),
  mini_app: mesh('#EDE9FE', '#C4B5FD', '#DDD6FE'),
  knowledge: mesh('#ECFCCB', '#BEF264', '#D9F99D'),
  files: mesh('#FEF3C7', '#FCD34D', '#FDE68A'),
  code_tools: mesh('#E0E7FF', '#A5B4FC', '#C7D2FE'),
  notes: mesh('#FFEDD5', '#FDBA74', '#FED7AA'),
  openclaw: mesh('#FECACA', '#FCA5A5', '#FECACA')
}

const APP_ICON_BACKGROUNDS_DARK_MUTED: Record<SidebarFavorite, string> = {
  assistants: mesh('#BFDBFE', '#93C5FD', '#C7D2FE'),
  agents: mesh('#A5F3FC', '#7DD3FC', '#BAE6FD'),
  store: mesh('#99F6E4', '#5EEAD4', '#A7F3D0'),
  paintings: mesh('#FBCFE8', '#F9A8D4', '#F5D0FE'),
  translate: mesh('#BBF7D0', '#86EFAC', '#D9F99D'),
  mini_app: mesh('#DDD6FE', '#C4B5FD', '#F5D0FE'),
  knowledge: mesh('#D9F99D', '#BEF264', '#A7F3D0'),
  files: mesh('#FDE68A', '#FCD34D', '#FED7AA'),
  code_tools: mesh('#C7D2FE', '#A5B4FC', '#DDD6FE'),
  notes: mesh('#FED7AA', '#FDBA74', '#FECACA'),
  openclaw: mesh('#FECACA', '#FCA5A5', '#FED7AA')
}

// Vivid: one-two Tailwind shades deeper/more saturated per stop than the baseline.
const APP_ICON_BACKGROUNDS_LIGHT_VIVID: Record<SidebarFavorite, string> = {
  assistants: mesh('#93C5FD', '#3B82F6', '#818CF8'),
  agents: mesh('#67E8F9', '#0EA5E9', '#38BDF8'),
  store: mesh('#5EEAD4', '#14B8A6', '#2DD4BF'),
  paintings: mesh('#F9A8D4', '#EC4899', '#F472B6'),
  translate: mesh('#86EFAC', '#22C55E', '#4ADE80'),
  mini_app: mesh('#C4B5FD', '#8B5CF6', '#A78BFA'),
  knowledge: mesh('#BEF264', '#84CC16', '#A3E635'),
  files: mesh('#FCD34D', '#F59E0B', '#FBBF24'),
  code_tools: mesh('#A5B4FC', '#6366F1', '#818CF8'),
  notes: mesh('#FDBA74', '#F97316', '#FB923C'),
  openclaw: mesh('#F87171', '#EF4444', '#F87171')
}

const APP_ICON_BACKGROUNDS_DARK_VIVID: Record<SidebarFavorite, string> = {
  assistants: mesh('#60A5FA', '#2563EB', '#6366F1'),
  agents: mesh('#22D3EE', '#0284C7', '#0EA5E9'),
  store: mesh('#2DD4BF', '#0D9488', '#14B8A6'),
  paintings: mesh('#F472B6', '#DB2777', '#EC4899'),
  translate: mesh('#4ADE80', '#16A34A', '#22C55E'),
  mini_app: mesh('#A78BFA', '#7C3AED', '#8B5CF6'),
  knowledge: mesh('#A3E635', '#65A30D', '#84CC16'),
  files: mesh('#FBBF24', '#D97706', '#F59E0B'),
  code_tools: mesh('#818CF8', '#4F46E5', '#6366F1'),
  notes: mesh('#FB923C', '#EA580C', '#F97316'),
  openclaw: mesh('#EF4444', '#DC2626', '#EF4444')
}

const PALETTE_VARIANTS = {
  current: { light: APP_ICON_BACKGROUNDS_LIGHT, dark: APP_ICON_BACKGROUNDS_DARK },
  muted: { light: APP_ICON_BACKGROUNDS_LIGHT_MUTED, dark: APP_ICON_BACKGROUNDS_DARK_MUTED },
  vivid: { light: APP_ICON_BACKGROUNDS_LIGHT_VIVID, dark: APP_ICON_BACKGROUNDS_DARK_VIVID }
} as const

type PaletteVariantKey = keyof typeof PALETTE_VARIANTS

const PALETTE_VARIANT_OPTIONS: { value: PaletteVariantKey; label: string }[] = [
  { value: 'current', label: '现在' },
  { value: 'muted', label: '柔和' },
  { value: 'vivid', label: '浓郁' }
]

// --- end TEMP block ---

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
  // TEMP: design-review-only palette switcher, see PALETTE_VARIANTS above.
  const [paletteVariant, setPaletteVariant] = useState<PaletteVariantKey>('current')

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

  const activePalette = PALETTE_VARIANTS[paletteVariant]
  const appIconBackgrounds = theme === ThemeMode.dark ? activePalette.dark : activePalette.light

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
    <div className="relative flex h-full min-h-0 flex-col bg-background">
      {/* TEMP: design-review-only palette switcher, remove with the PALETTE_VARIANTS block above. */}
      <SegmentedControl
        options={PALETTE_VARIANT_OPTIONS}
        value={paletteVariant}
        onValueChange={setPaletteVariant}
        size="sm"
        className="absolute top-3 right-3 z-10"
      />
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
