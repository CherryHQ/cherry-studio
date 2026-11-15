import { getProviderIconAssetMetrics } from '@cherrystudio/ui/icons'

export interface IconDisplayConfig {
  scale: number
  borderRadius?: number
}

export type IconDisplayContext = 'mini-app' | 'provider-list'

export const miniAppContainedIcon: Readonly<IconDisplayConfig> = { scale: 5 / 7, borderRadius: 10 }
const defaultIcon: IconDisplayConfig = { scale: 1.2 }

export function getIconDisplayConfig(
  context: IconDisplayContext,
  iconId: string | undefined
): IconDisplayConfig | undefined {
  if (!iconId) return undefined
  const providerMetrics = getProviderIconAssetMetrics({ kind: 'provider', iconId })
  if (context === 'provider-list' && providerMetrics.kind === 'full-canvas') return { scale: 1 }
  const isTile =
    providerMetrics.kind === 'tile' || getProviderIconAssetMetrics({ kind: 'model', iconId }).kind === 'tile'
  return isTile ? { scale: 1, borderRadius: context === 'mini-app' ? 10 : 5 } : defaultIcon
}
