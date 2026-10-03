import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'

import { usePreference } from '@data/hooks/usePreference'
import { getSidebarIconLabelKey } from '@renderer/i18n/label'
import { DEEPSEEK_HARNESS_ICON, DEEPSEEK_HARNESS_URL, LAUNCHPAD_APP_ICONS } from '@renderer/utils/launchpadApps'
import { getSidebarMenuPath } from '@renderer/utils/sidebar'
import type { MiniApp } from '@shared/data/types/miniApp'

import { useLaunchpadAppOrder } from './useLaunchpadAppOrder'

export function useLaunchpadCatalog(pinned: MiniApp[]) {
  const { t } = useTranslation()
  const [provider] = usePreference('feature.paintings.default_provider')
  const { orderedAppIds, reorderApps } = useLaunchpadAppOrder()
  const apps = useMemo(
    () =>
      orderedAppIds.flatMap((id) => {
        const url = getSidebarMenuPath(id, provider)
        return url ? [{ id, url, label: t(getSidebarIconLabelKey(id)), iconSrc: LAUNCHPAD_APP_ICONS[id] }] : []
      }),
    [orderedAppIds, provider, t]
  )
  const shortcuts = [
    {
      id: 'deepseek-harness',
      url: DEEPSEEK_HARNESS_URL,
      label: t('launchpad.deepseek_harness_shortcut'),
      iconSrc: DEEPSEEK_HARNESS_ICON
    }
  ]
  const miniApps = useMemo(
    () => [...pinned].sort((a, b) => (a.orderKey < b.orderKey ? -1 : a.orderKey > b.orderKey ? 1 : 0)),
    [pinned]
  )
  return { apps, shortcuts, miniApps, reorderApps }
}
