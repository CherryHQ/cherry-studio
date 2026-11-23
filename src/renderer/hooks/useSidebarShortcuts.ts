import { isEqual } from 'es-toolkit/compat'
import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { trackProductEvent } from '@renderer/services/productAnalytics'
import { sidebarShortcutService } from '@renderer/services/SidebarShortcutService'
import {
  getVisibleSidebarShortcutItems,
  isSidebarShortcutPinned,
  normalizeSidebarShortcutItems,
  SIDEBAR_SHORTCUT_PROVIDER_IDS
} from '@renderer/utils/sidebar'
import type { SidebarShortcutItem, SidebarShortcutTarget } from '@shared/data/preference/preferenceTypes'

import { toast } from '../services/toast'

export function useSidebarShortcuts() {
  const { t } = useTranslation()
  const [stored] = usePreference('ui.sidebar_shortcut')
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
    (target: SidebarShortcutTarget, pinned: boolean, fallbackLabel?: string) => {
      const operation = sidebarShortcutService.setPinned(target, pinned, fallbackLabel)
      // Every pin entry point (mini apps page, split picker, launchpad) runs through here.
      if (pinned && target.locator.providerId === SIDEBAR_SHORTCUT_PROVIDER_IDS.MINI_APP) {
        // runMutation reports a failed save; this branch only skips the event.
        void operation.then(
          () => trackProductEvent({ event: 'feature_used', feature: 'mini_app', action: 'app_pinned' }),
          () => undefined
        )
      }
      runMutation(operation)
    },
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

  return { shortcuts, isPinned, setPinned, remove, reorder }
}
