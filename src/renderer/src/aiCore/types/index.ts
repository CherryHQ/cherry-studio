/**
 * This type definition file is only for renderer.
 * It cannot be migrated to @renderer/types since files within it are actually being used by both main and renderer.
 * If we do that, main would throw an error because it cannot import a module which imports a type from a browser-enviroment-only package.
 * (ai-core package is set as browser-enviroment-only)
 *
 * TODO: We should separate them clearly. Keep renderer only types in renderer, and main only types in main, and shared types in shared.
 */

import type { ProviderSettingsMap } from '@cherrystudio/ai-core/provider'

export type AiSdkConfig = {
  providerId: string
  options: ProviderSettingsMap[keyof ProviderSettingsMap]
}
