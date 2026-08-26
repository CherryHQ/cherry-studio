import type { CommandContextMenuExtraItem } from '@renderer/components/command'
import type { Tab } from '@shared/data/cache/cacheValueTypes'
import type { ReactNode } from 'react'

export interface SidebarMiniApp {
  id: string
  color?: string
  url?: string
  logo?: string
}

export interface SidebarMiniAppTab {
  title: string
  miniApp: SidebarMiniApp
}

/** The tab state a resolved entry matches itself against. */
export interface SidebarTabState {
  /** Built-in app id of the current tab. */
  activeItem: string
  /** Every open tab, foreground or not. */
  tabs?: readonly Tab[]
  /** The foreground tab. */
  currentTab?: Tab
}

/**
 * A fully-resolved, type-agnostic sidebar row. The app layer produces these from
 * the tagged favorites via the variant registry (see `components/app/sidebarVariants`);
 * the presentation layer renders them without knowing whether a row is a built-in
 * app or a mini app. Adding a new sidebar item type is a new variant descriptor —
 * leaf item rows keep this presentation contract.
 */
export interface ResolvedSidebarEntry {
  /** Stable identity — react key and reorder-matching key (`${type}:${id}`). */
  key: string
  label: string
  renderIcon: (size: number, miniAppSize: 'md' | 'lg') => ReactNode
  /** Open in some tab, foreground or not — drives the click (activate vs. create). */
  isOpen: (state: SidebarTabState) => boolean
  /** Open in the foreground tab. Implies `isOpen`. */
  isCurrent: (state: SidebarTabState) => boolean
  onOpen: () => void
  onOpenNewTab?: () => void
  contextMenuItems?: readonly CommandContextMenuExtraItem[]
}

export type SidebarLayout = 'hidden' | 'icon' | 'full'

export type SidebarVisibleLayout = Exclude<SidebarLayout, 'hidden'>

export interface SidebarUser {
  name: string
  avatar?: string
  onClick?: () => void
}
