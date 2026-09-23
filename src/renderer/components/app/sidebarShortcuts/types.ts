import type { ReactNode } from 'react'

import type { SidebarShortcutItem, SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import type { ConversationNavigationTarget } from '@shared/types/navigation'

import type { SidebarIconPresentation } from '../../Sidebar'

export interface SidebarNavigationSnapshot {
  url: string
  assistantId?: string
  agentId?: string
}

export interface SidebarActivationGateway {
  openWorkspace(
    destination: {
      url: string
      title: string
      icon?: string
      conversation?: ConversationNavigationTarget
      /** Whether the active view already renders this destination, so activation can no-op. */
      matchesCurrent?: (url: string) => boolean
      /**
       * Whether a tab IS this destination, used to focus it instead of repurposing the active tab.
       * Defaults to exact URL equality; view-only destinations (apps) opt out with `() => false`.
       */
      matchesTab?: (url: string) => boolean
    },
    options?: { inNewTab?: boolean }
  ): void
}

export interface ResolvedShortcut {
  label: string
  renderIcon: (presentation: SidebarIconPresentation) => ReactNode
  tabIcon?: string
  supportsNewTab?: boolean
}

export interface SidebarShortcutProvider {
  id: string
  validate(target: SidebarShortcutTarget): boolean
  resolveMany(targets: readonly SidebarShortcutTarget[]): Promise<Map<string, ResolvedShortcut>>
  subscribe?(targets: readonly SidebarShortcutTarget[], invalidate: () => void): () => void
  activate(target: SidebarShortcutTarget, gateway: SidebarActivationGateway): void | Promise<void>
  isActive?(target: SidebarShortcutTarget, navigation: SidebarNavigationSnapshot): boolean
}

export type SidebarShortcutResolution =
  | { status: 'loading'; shortcut: SidebarShortcutItem }
  | { status: 'resolved'; shortcut: SidebarShortcutItem; resource: ResolvedShortcut }
  | { status: 'missing' | 'unavailable'; shortcut: SidebarShortcutItem }
