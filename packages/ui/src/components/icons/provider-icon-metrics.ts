import { MODEL_ICON_META_CATALOG } from './models/meta-catalog'
import { PROVIDER_ICON_META_CATALOG } from './providers/meta-catalog'
import type { IconMeta } from './types'

export interface ProviderIconAssetMetrics {
  canvasScale: number
  kind: 'mark' | 'tile'
}

const INSET_PROVIDER_CANVAS_SCALE = 120 / 65
const INSET_MODEL_CANVAS_SCALE = 24 / 16

export function getProviderIconAssetMetrics({
  kind,
  iconId
}: {
  kind: 'provider' | 'model'
  iconId: string
}): ProviderIconAssetMetrics {
  const catalog: Readonly<Record<string, IconMeta>> = kind === 'model' ? MODEL_ICON_META_CATALOG : PROVIDER_ICON_META_CATALOG
  if (catalog[iconId.toLowerCase()]?.artworkKind === 'tile') return { canvasScale: 1, kind: 'tile' }
  return { canvasScale: kind === 'model' ? INSET_MODEL_CANVAS_SCALE : INSET_PROVIDER_CANVAS_SCALE, kind: 'mark' }
}
