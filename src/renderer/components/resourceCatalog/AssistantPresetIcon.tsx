import { useIcon } from '@cherrystudio/ui/icons'
import type { AssistantCatalogPreset } from '@renderer/hooks/useAssistantCatalogPresets'
import { getOfficialAssistantIconRef } from '@renderer/utils/resourceCatalog'

type AssistantPresetIconProps = {
  preset: Pick<AssistantCatalogPreset, 'emoji' | 'officialVendor'>
  size?: number
}

export function AssistantPresetIcon({ preset, size = 18 }: AssistantPresetIconProps) {
  const iconRef = preset.officialVendor ? getOfficialAssistantIconRef(preset.officialVendor) : undefined
  const BrandIcon = useIcon(iconRef)

  return BrandIcon ? (
    <BrandIcon aria-hidden="true" style={{ width: size, height: size }} />
  ) : (
    <span aria-hidden="true" style={{ fontSize: size }}>
      {preset.emoji || '🤖'}
    </span>
  )
}
