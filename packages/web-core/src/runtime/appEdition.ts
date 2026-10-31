import type { AppEdition } from '@shared/types/appEdition'

// Browser `utils/appEdition`: the desktop reads the edition from the packaged app; the Web
// edition serves the global catalog.
export function getAppEdition(): AppEdition {
  return 'global'
}
