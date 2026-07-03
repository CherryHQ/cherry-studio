import { usePreference } from '@data/hooks/usePreference'
import { getOrderedLaunchpadApps, reorderLaunchpadApps } from '@renderer/utils/sidebar'
import { useCallback, useMemo } from 'react'
import { useTranslation } from 'react-i18next'

/**
 * Single entry point for the `ui.launchpad.app_order` preference — the launchpad's
 * own built-in app tile order, independent of the sidebar favorites order.
 *
 * `orderedAppIds` is the normalized app order (stored order first, any missing app
 * appended in canonical order); `reorderApps` persists a new order. Mini app tiles
 * are ordered separately by their global `orderKey`, so the launchpad never touches
 * `ui.sidebar.favorites`.
 */
export function useLaunchpadAppOrder() {
  const { t } = useTranslation()
  const [appOrder, setAppOrder] = usePreference('ui.launchpad.app_order')

  const orderedAppIds = useMemo(() => getOrderedLaunchpadApps(appOrder), [appOrder])

  const reorderApps = useCallback(
    (orderedIds: readonly string[]) => {
      void setAppOrder(reorderLaunchpadApps(appOrder, orderedIds)).catch(() => {
        window.toast?.error(t('common.error'))
      })
    },
    [appOrder, setAppOrder, t]
  )

  return { orderedAppIds, reorderApps }
}
