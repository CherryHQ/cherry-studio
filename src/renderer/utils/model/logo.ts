import type { CompoundIcon } from '@cherrystudio/ui'
import { resolveIcon, resolveModelIcon } from '@cherrystudio/ui/icons'

export type { CompoundIcon }

type LogoModel = {
  id: string
  name: string
  provider?: string
  providerId?: string
}

export function getModelLogoById(modelId: string): CompoundIcon | undefined {
  return resolveModelIcon(modelId)
}

export function getModelLogo(model: LogoModel | undefined | null, providerId?: string): CompoundIcon | undefined {
  if (!model) return undefined
  const pid = providerId ?? model.providerId ?? model.provider
  if (pid) {
    return resolveIcon(model.id, pid) ?? resolveIcon(model.name, pid)
  }
  return resolveModelIcon(model.id) ?? resolveModelIcon(model.name)
}
