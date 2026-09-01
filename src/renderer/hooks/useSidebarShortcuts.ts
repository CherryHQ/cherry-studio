import { usePreference } from '@data/hooks/usePreference'
import { sidebarShortcutService } from '@renderer/services/SidebarShortcutService'
import {
  getVisibleSidebarShortcutItems,
  isSidebarShortcutPinned,
  normalizeSidebarShortcutItems
} from '@renderer/utils/sidebar'
import type { SidebarShortcutItem, SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'
import { isEqual } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { toast } from '../services/toast'

export function useSidebarShortcuts() {
  const { t } = useTranslation()
  const [stored] = usePreference('ui.sidebar.favorites')
  const shortcuts = useMemo(() => getVisibleSidebarShortcutItems(stored), [stored])
  const normalized = useMemo(() => normalizeSidebarShortcutItems(stored), [stored])
  const needsNormalization = !isEqual(stored, normalized)

  const runMutation = useCallback(
    (operation: Promise<void>) => {
      void operation.catch(() => toast.error(t('common.error')))
    },
    [t]
  )

  useEffect(() => {
    if (needsNormalization) runMutation(sidebarShortcutService.normalize())
  }, [needsNormalization, runMutation])

  const isPinned = useCallback(
    (target: SidebarShortcutTarget) => isSidebarShortcutPinned(shortcuts, target),
    [shortcuts]
  )
  const setPinned = useCallback(
    (target: SidebarShortcutTarget, pinned: boolean, fallbackLabel?: string) =>
      runMutation(sidebarShortcutService.setPinned(target, pinned, fallbackLabel)),
    [runMutation]
  )
  const toggle = useCallback(
    (target: SidebarShortcutTarget, fallbackLabel?: string) =>
      runMutation(sidebarShortcutService.toggle(target, fallbackLabel)),
    [runMutation]
  )
  const remove = useCallback(
    (target: SidebarShortcutTarget) => runMutation(sidebarShortcutService.remove(target)),
    [runMutation]
  )
  const reorder = useCallback(
    (items: readonly SidebarShortcutItem[]) => {
      const operation = sidebarShortcutService.reorder(items)
      runMutation(operation)
      return operation
    },
    [runMutation]
  )

  return { shortcuts, isPinned, setPinned, toggle, remove, reorder }
}
