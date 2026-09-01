import type { SidebarShortcutItem, SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import type { ReactNode } from 'react'

import type { SidebarIconPresentation } from '../../Sidebar'

export interface SidebarNavigationSnapshot {
  url: string
}

export interface SidebarActivationGateway {
  openWorkspace(
    destination: { url: string; title: string; icon?: string; matchesCurrent?: (url: string) => boolean },
    options?: { inNewTab?: boolean }
  ): void
  openSettings(path: string): void
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
