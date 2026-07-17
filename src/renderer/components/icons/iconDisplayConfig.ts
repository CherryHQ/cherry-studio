export interface IconDisplayConfig {
  scale: number
  borderRadius?: number
}

export type IconDisplayContext = 'mini-app' | 'provider-list'

const miniAppContainedIcon: IconDisplayConfig = { scale: 5 / 7, borderRadius: 10 }
const providerListContainedIcon: IconDisplayConfig = { scale: 5 / 7, borderRadius: 5 }
const providerListDefaultIcon: IconDisplayConfig = { scale: 1.2 }

const ICON_DISPLAY_CONFIG: Readonly<Record<IconDisplayContext, Readonly<Record<string, IconDisplayConfig>>>> = {
  'mini-app': {
    abacus: miniAppContainedIcon,
    zeroone: miniAppContainedIcon,
    minimax: miniAppContainedIcon,
    groq: miniAppContainedIcon,
    anthropic: miniAppContainedIcon,
    claude: miniAppContainedIcon,
    felo: miniAppContainedIcon,
    mintop3: miniAppContainedIcon,
    '3mintop': miniAppContainedIcon,
    coze: miniAppContainedIcon
  },
  'provider-list': {
    cherryin: providerListContainedIcon,
    aihubmix: providerListContainedIcon,
    lmstudio: providerListContainedIcon,
    anthropic: providerListContainedIcon,
    yi: providerListContainedIcon,
    groq: providerListContainedIcon,
    'aws-bedrock': providerListContainedIcon
  }
}

export function getIconDisplayConfig(
  context: IconDisplayContext,
  iconId: string | undefined
): IconDisplayConfig | undefined {
  if (!iconId) return undefined
  return (
    ICON_DISPLAY_CONFIG[context][iconId.toLowerCase()] ??
    (context === 'provider-list' ? providerListDefaultIcon : undefined)
  )
}
