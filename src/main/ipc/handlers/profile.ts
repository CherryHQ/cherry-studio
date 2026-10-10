import { profileService } from '@main/services/ProfileService'
import type { profileRequestSchemas } from '@shared/ipc/schemas/profile'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const profileHandlers: IpcHandlersFor<typeof profileRequestSchemas> = {
  'profile.set_avatar': (input) => profileService.setAvatar(input)
}
