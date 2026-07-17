export interface MiniAppIconDisplayConfig {
  scale: number
  borderRadius: number
}

const containedIcon: MiniAppIconDisplayConfig = { scale: 5 / 7, borderRadius: 10 }

/** Mini-app logos with full-bleed backgrounds need breathing room inside the launchpad frame. */
export const MINI_APP_ICON_CONFIG: Readonly<Record<string, MiniAppIconDisplayConfig>> = {
  abacus: containedIcon,
  zeroone: containedIcon,
  minimax: containedIcon,
  groq: containedIcon,
  anthropic: containedIcon,
  claude: containedIcon,
  felo: containedIcon,
  mintop3: containedIcon,
  '3mintop': containedIcon,
  coze: containedIcon
}

export function getMiniAppIconDisplayConfig(logoId: string | undefined): MiniAppIconDisplayConfig | undefined {
  if (!logoId) return undefined
  return MINI_APP_ICON_CONFIG[logoId.toLowerCase()]
}
