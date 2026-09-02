import type { AppEdition } from '@shared/types/appEdition'

export function useAppEdition(): AppEdition {
  return __APP_EDITION__
}
