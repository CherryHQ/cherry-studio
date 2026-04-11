import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveIcon, resolveModelIcon } from '@cherrystudio/ui/icons'

import type { ProviderSettingsLogoModel } from './types'

export type { CompoundIcon }

export function getModelLogoById(modelId: string): CompoundIcon | undefined {
  return resolveModelIcon(modelId)
}

export function getModelLogo(model: ProviderSettingsLogoModel | undefined | null): CompoundIcon | undefined {
  if (!model) {
    return undefined
  }

  return (
    resolveIcon(model.id, model.providerId) ??
    resolveIcon(model.name, model.providerId) ??
    resolveModelIcon(model.id) ??
    resolveModelIcon(model.name)
  )
}
