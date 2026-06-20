import EmojiIcon from '@renderer/components/EmojiIcon'
import { getMiniAppsLogo } from '@renderer/config/miniApps'
import { cn } from '@renderer/utils'
import type { FC } from 'react'

import type { Tab } from '../../hooks/useTabs'
import { getTabIcon, TAB_ICON_EMOJI_PREFIX } from './tabIcons'

/**
 * Renders a tab's icon: a per-entity emoji (`emoji:<glyph>`), a mini-app logo,
 * an image url, or — when no icon is set — the route's default lucide glyph.
 * Shared by the main tab strip (AppShellTabBar) and the sub-window title bar.
 */
export const TabIcon: FC<{ tab: Tab; size: number; className?: string }> = ({ tab, size, className }) => {
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
    const logo = getMiniAppsLogo(tab.icon)
    if (logo) {
      const Compound = logo
      return <Compound.Avatar size={size} shape="rounded" className={cn('select-none', className)} />
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
