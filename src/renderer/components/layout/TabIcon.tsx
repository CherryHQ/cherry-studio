import EmojiIcon from '@renderer/components/EmojiIcon'
import { getMiniAppsLogoRef, useMiniAppLogo } from '@renderer/components/icons/miniAppsLogo'
import { cn } from '@renderer/utils/style'
import { TAB_ICON_EMOJI_PREFIX } from '@renderer/utils/tabIcons'
import type { FC } from 'react'

import type { Tab } from '../../hooks/tab'
import { getTabIcon } from './tabIcons'

/**
 * Renders a tab's icon: a per-entity emoji (`emoji:<glyph>`), a mini-app logo,
 * an image url, or — when no icon is set — the route's default lucide glyph.
 * Shared by the main tab strip (AppShellTabBar) and the sub-window title bar.
 */
export const TabIcon: FC<{ tab: Tab; size: number; className?: string }> = ({ tab, size, className }) => {
  // Branching is decided synchronously from the ref; only the icon component
  // itself loads async (a size-stable placeholder covers that brief window).
  const Logo = useMiniAppLogo(tab.icon)
  if (tab.icon) {
    // Per-entity emoji (chat assistant / agent avatar), stored as `emoji:<glyph>`.
    if (tab.icon.startsWith(TAB_ICON_EMOJI_PREFIX)) {
      return (
        <EmojiIcon
          emoji={tab.icon.slice(TAB_ICON_EMOJI_PREFIX.length)}
          size={size}
          fontSize={Math.round(size * 0.62)}
          className={cn('mr-0', className)}
        />
      )
    }
    if (getMiniAppsLogoRef(tab.icon)) {
      return Logo ? (
        <Logo.Avatar size={size} shape="rounded" className={cn('select-none', className)} />
      ) : (
        <span className={cn('inline-block shrink-0', className)} style={{ width: size, height: size }} />
      )
    }
    return (
      <img
        src={tab.icon}
        alt=""
        draggable={false}
        className={cn('select-none rounded-[3px] object-cover', className)}
        style={{ width: size, height: size }}
      />
    )
  }
  const Icon = getTabIcon(tab)
  return <Icon size={size} strokeWidth={1.6} className={className} />
}
