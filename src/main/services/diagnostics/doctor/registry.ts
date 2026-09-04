import { bootConfigValid } from './checks/config'
import { userDataLocation } from './checks/storage'
import type { DoctorCheckRegistry } from './types'

/** One entry per catalog id; the type makes a missing or extra entry a compile error. */
export const doctorCheckRegistry: DoctorCheckRegistry = {
  'config-boot-config-valid': bootConfigValid,
  'storage-userdata-location': userDataLocation
}
