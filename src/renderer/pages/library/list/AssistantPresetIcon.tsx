import type { CompoundIcon } from '@cherrystudio/ui'
import { MODEL_ICON_CATALOG, resolveProviderIcon } from '@cherrystudio/ui/icons'
import { useTheme } from '@renderer/context/ThemeProvider'
import { ThemeMode } from '@shared/data/preference/preferenceTypes'

import type { AssistantCatalogPreset } from './useAssistantPresetCatalog'

interface AssistantPresetIconProps {
  preset: AssistantCatalogPreset
  /** SVG dimensions in pixels for the rendered brand icon. */
  iconSize?: number
}

/**
 * Render an assistant preset's avatar.
 *
 * Resolution order for `preset.iconKey`:
 *   1. MODEL_ICON_CATALOG — model brand mark (Claude / Kimi / Doubao etc., what
 *      the user recognizes from the model picker).
 *   2. resolveProviderIcon — the company/provider logo (Anthropic A, OpenAI flower,
 *      DeepSeek whale, etc.). Used when no model-specific mark exists.
 *
 * Falls back to `preset.emoji` (or 🤖) for presets without an icon key.
 */
export function AssistantPresetIcon({ preset, iconSize = 22 }: AssistantPresetIconProps) {
  const { theme } = useTheme()
  const Icon = preset.iconKey ? resolvePresetIcon(preset.iconKey) : null

  if (Icon) {
    return <Icon variant={theme === ThemeMode.dark ? 'dark' : 'light'} style={{ width: iconSize, height: iconSize }} />
  }

  return <>{preset.emoji || '🤖'}</>
}

function resolvePresetIcon(iconKey: string): CompoundIcon | undefined {
  const modelIcon = (MODEL_ICON_CATALOG as Record<string, CompoundIcon>)[iconKey]
  if (modelIcon) return modelIcon
  return resolveProviderIcon(iconKey)
}
