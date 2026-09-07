export interface ProviderIconAssetMetrics {
  canvasScale: number
  kind: 'mark' | 'tile'
}

const INSET_PROVIDER_CANVAS_SCALE = 120 / 65
const INSET_MODEL_CANVAS_SCALE = 24 / 16
const TILE_PROVIDER_IDS = new Set(['cherryin', 'aihubmix', 'lmstudio', 'anthropic', 'yi', 'groq', 'aws-bedrock'])

export function getProviderIconAssetMetrics({
  kind,
  iconId
}: {
  kind: 'provider' | 'model'
  iconId: string
}): ProviderIconAssetMetrics {
  if (kind === 'model') return { canvasScale: INSET_MODEL_CANVAS_SCALE, kind: 'mark' }
  if (TILE_PROVIDER_IDS.has(iconId.toLowerCase())) return { canvasScale: 1, kind: 'tile' }
  return { canvasScale: INSET_PROVIDER_CANVAS_SCALE, kind: 'mark' }
}
