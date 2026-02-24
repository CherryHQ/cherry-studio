import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveIcon, resolveModelIcon } from '@cherrystudio/ui/icons'
import type { Model } from '@renderer/types'

export type { CompoundIcon }

export function getModelLogoById(modelId: string): CompoundIcon | undefined {
  return resolveModelIcon(modelId)
}

export function getModelLogo(model: Model | undefined | null, providerId?: string): CompoundIcon | undefined {
  if (!model) return undefined
  const pid = providerId ?? model.provider
  if (pid) {
    return resolveIcon(model.id, pid) ?? resolveIcon(model.name, pid)
  }
  return resolveModelIcon(model.id) ?? resolveModelIcon(model.name)
}
