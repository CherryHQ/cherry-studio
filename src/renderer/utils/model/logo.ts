import type { IconRef } from '@cherrystudio/ui/icons'
import { resolveIconRef, resolveModelIconRef } from '@cherrystudio/ui/icons'

type LogoModel = {
  id: string
  name: string
  provider?: string
  providerId?: string
}

/**
 * Synchronously resolve a model's logo to an IconRef (meta catalogs only —
 * no icon components on this path). Render the component via `useIcon(ref)`.
 */
export function getModelLogoRef(model: LogoModel | undefined | null, providerId?: string): IconRef | undefined {
  if (!model) return undefined
  const pid = providerId ?? model.providerId ?? model.provider
  if (pid) {
    return resolveIconRef(model.id, pid) ?? resolveIconRef(model.name, pid)
  }
  return resolveModelIconRef(model.id) ?? resolveModelIconRef(model.name)
}
