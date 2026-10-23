import { useMemo } from 'react'

// Wraps the desktop launchpad order: the Web edition offers only agents and chat.
import { useLaunchpadAppOrder as useDesktopLaunchpadAppOrder } from '@renderer/hooks/useLaunchpadAppOrder'

const webApps = new Set(['agents', 'assistants'])

export function useLaunchpadAppOrder() {
  const { orderedAppIds, reorderApps } = useDesktopLaunchpadAppOrder()
  return { orderedAppIds: useMemo(() => orderedAppIds.filter((id) => webApps.has(id)), [orderedAppIds]), reorderApps }
}
