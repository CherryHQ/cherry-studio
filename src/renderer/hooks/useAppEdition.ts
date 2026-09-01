import { appInfoService } from '@renderer/services/AppInfoService'
import type { AppEdition } from '@shared/types/appEdition'

export function useAppEdition(): AppEdition {
  return appInfoService.get().edition
}
