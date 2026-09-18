import { when } from '@main/core/lifecycle'
import { bootConfigService } from '@main/data/bootConfig'

/**
 * Excludes a service while lite mode is on. Read from BootConfig rather than Preference because
 * `@Conditional` is evaluated synchronously at registration, before PreferenceService exists.
 */
export function unlessLiteMode() {
  return when(() => !bootConfigService.get('app.lite_mode'), 'lite mode is off')
}
