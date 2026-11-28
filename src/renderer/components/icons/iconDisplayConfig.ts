import { getProviderIconAssetMetrics } from '@cherrystudio/ui/icons'

export interface IconDisplayConfig {
  scale: number
  borderRadius?: number
}

export type IconDisplayContext = 'mini-app' | 'provider-list'

export const SETTINGS_LIST_ICON_FRAME_CLASS = 'shrink-0 rounded-md border border-border-subtle'
export const SETTINGS_LIST_TILE_RADIUS = 5

const defaultIcon: IconDisplayConfig = { scale: 1.2 }

export function getIconDisplayConfig(
  context: IconDisplayContext,
  iconId: string | undefined
): IconDisplayConfig | undefined {
  if (!iconId) return undefined
  const isTile =
    getProviderIconAssetMetrics({ kind: 'provider', iconId }).kind === 'tile' ||
    getProviderIconAssetMetrics({ kind: 'model', iconId }).kind === 'tile'
  return isTile ? { scale: 1, borderRadius: context === 'mini-app' ? 10 : SETTINGS_LIST_TILE_RADIUS } : defaultIcon
}
