import { getProviderIconAssetMetrics } from '@cherrystudio/ui/icons'

export interface IconDisplayConfig {
  scale: number
  borderRadius?: number
}

export type IconDisplayContext = 'mini-app' | 'provider-list'

export const miniAppContainedIcon: Readonly<IconDisplayConfig> = { scale: 5 / 7, borderRadius: 10 }
const providerListContainedIcon: IconDisplayConfig = { scale: 5 / 7, borderRadius: 5 }
const defaultIcon: IconDisplayConfig = { scale: 1.2 }

const MINI_APP_ICON_DISPLAY_CONFIG: Readonly<Record<string, IconDisplayConfig>> = {
  abacus: miniAppContainedIcon,
  zeroone: miniAppContainedIcon,
  minimax: miniAppContainedIcon,
  'radeon-cloud': miniAppContainedIcon,
  groq: miniAppContainedIcon,
  anthropic: miniAppContainedIcon,
  claude: miniAppContainedIcon,
  felo: miniAppContainedIcon,
  mintop3: miniAppContainedIcon,
  '3mintop': miniAppContainedIcon,
  coze: miniAppContainedIcon,
  ling: miniAppContainedIcon
}

export function getIconDisplayConfig(
  context: IconDisplayContext,
  iconId: string | undefined
): IconDisplayConfig | undefined {
  if (!iconId) return undefined
  if (context === 'provider-list') {
    return getProviderIconAssetMetrics({ kind: 'provider', iconId }).kind === 'tile'
      ? providerListContainedIcon
      : defaultIcon
  }
  return MINI_APP_ICON_DISPLAY_CONFIG[iconId.toLowerCase()] ?? defaultIcon
}
