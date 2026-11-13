import { getProviderIconAssetMetrics } from '@cherrystudio/ui/icons'

export interface IconDisplayConfig {
  scale: number
  borderRadius?: number
  viewBox?: string
}

export type IconDisplayContext = 'mini-app' | 'provider-list'

export const miniAppContainedIcon: Readonly<IconDisplayConfig> = { scale: 5 / 7, borderRadius: 10 }
const providerListContainedIcon: IconDisplayConfig = { scale: 5 / 7, borderRadius: 5 }
const defaultIcon: IconDisplayConfig = { scale: 1.2 }
const miniAppInsetTileIcon: Readonly<IconDisplayConfig> = {
  ...miniAppContainedIcon,
  viewBox: '27.5 27.5 65 65'
}

const MINI_APP_ICON_DISPLAY_CONFIG: Readonly<Record<string, IconDisplayConfig>> = {
  abacus: miniAppContainedIcon,
  'zero-one': miniAppContainedIcon,
  'minimax-agent': miniAppContainedIcon,
  'radeon-cloud': miniAppContainedIcon,
  groq: miniAppContainedIcon,
  anthropic: miniAppContainedIcon,
  felo: miniAppContainedIcon,
  '3min-top': miniAppContainedIcon,
  coze: miniAppContainedIcon,
  ling: miniAppContainedIcon,
  canva: miniAppInsetTileIcon,
  gamma: miniAppInsetTileIcon,
  napkin: miniAppInsetTileIcon
}

export function getIconDisplayConfig(
  context: IconDisplayContext,
  iconId: string | undefined
): IconDisplayConfig | undefined {
  if (!iconId) return undefined
  const normalizedIconId = iconId.toLowerCase()
  if (context === 'provider-list') {
    return normalizedIconId === 'litellm' ||
      normalizedIconId === 'radeon-cloud' ||
      getProviderIconAssetMetrics({ kind: 'provider', iconId }).kind === 'tile'
      ? providerListContainedIcon
      : defaultIcon
  }
  return MINI_APP_ICON_DISPLAY_CONFIG[normalizedIconId] ?? defaultIcon
}
