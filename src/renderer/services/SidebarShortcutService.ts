import { isEqual } from 'es-toolkit/compat'

import { preferenceService } from '@renderer/data/PreferenceService'
import {
  addSidebarShortcut,
  isSidebarShortcutPinned,
  normalizeSidebarShortcutItems,
  removeSidebarShortcut,
  reorderSidebarShortcuts
} from '@renderer/utils/sidebar'
import type { SidebarShortcutItem, SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { Sequencer } from '@shared/utils/async'

type SidebarPreferenceClient = Pick<typeof preferenceService, 'get' | 'set'>

export class SidebarShortcutService {
  private readonly mutationQueue = new Sequencer()

  constructor(private readonly preferences: SidebarPreferenceClient = preferenceService) {}

  private enqueue(transform: (current: readonly unknown[]) => SidebarShortcutItem[]): Promise<void> {
    return this.mutationQueue.queue(async () => {
      const stored = await this.preferences.get('ui.sidebar_shortcut')
      const current = Array.isArray(stored) ? stored : []
      const next = transform(current)
      if (isEqual(current, next)) return
      await this.preferences.set('ui.sidebar_shortcut', next)
    })
  }

  normalize(): Promise<void> {
    return this.enqueue(normalizeSidebarShortcutItems)
  }

  setPinned(target: SidebarShortcutTarget, pinned: boolean, fallbackLabel?: string): Promise<void> {
    return this.enqueue((current) => {
      const isPinned = isSidebarShortcutPinned(current, target)
      if (isPinned === pinned) return normalizeSidebarShortcutItems(current)
      return pinned ? addSidebarShortcut(current, target, fallbackLabel) : removeSidebarShortcut(current, target)
    })
  }

  remove(target: SidebarShortcutTarget): Promise<void> {
    return this.enqueue((current) => removeSidebarShortcut(current, target))
  }

  reorder(orderedItems: readonly SidebarShortcutItem[]): Promise<void> {
    return this.enqueue((current) => reorderSidebarShortcuts(current, orderedItems))
  }
}

export const sidebarShortcutService = new SidebarShortcutService()
