import type { CustomPublishOptions } from 'builder-util-runtime'
import { type AppUpdater, Provider, type UpdateInfo } from 'electron-updater'
import type { ProviderRuntimeOptions } from 'electron-updater/out/providers/Provider'

import type { LegacyBridgeTarget } from './legacyBridgeTarget'

export function createLegacyBridgeProvider(target: LegacyBridgeTarget): CustomPublishOptions {
  const file: UpdateInfo['files'][number] = { url: target.url, sha512: target.sha512 }

  if ('size' in target) file.size = target.size

  const info: UpdateInfo = {
    version: target.version,
    files: [file],
    path: target.url,
    sha512: target.sha512,
    releaseDate: target.releaseDate
  }

  return {
    provider: 'custom',
    updateProvider: class extends Provider<UpdateInfo> {
      constructor(_options: CustomPublishOptions, _updater: AppUpdater, runtime: ProviderRuntimeOptions) {
        super(runtime)
      }

      async getLatestVersion() {
        return info
      }

      resolveFiles() {
        return [{ url: new URL(file.url), info: file }]
      }
    }
  }
}
