import { rmSync } from 'node:fs'

import { application } from '@application'
import type { RemoteRegistryFileName } from '@cherrystudio/provider-registry/node'
import { providerRegistryService } from '@main/data/services/ProviderRegistryService'
import { OVERRIDE_MANIFEST } from '@main/data/services/utils/registryDataPaths'
import { atomicWriteFile } from '@main/utils/file'
import { AbsoluteFilePathSchema } from '@shared/types/file'

/** Persist one complete remote-safe model snapshot and activate it atomically. */
export async function writeProviderRegistrySnapshot(
  files: Record<RemoteRegistryFileName, string>,
  manifestBody: string
): Promise<void> {
  const directory = 'feature.provider_registry.override' as const

  rmSync(application.getPath(directory, OVERRIDE_MANIFEST), { force: true })
  providerRegistryService.clearCache()

  for (const [name, body] of Object.entries(files)) {
    await atomicWriteFile(AbsoluteFilePathSchema.parse(application.getPath(directory, name)), body)
  }
  await atomicWriteFile(AbsoluteFilePathSchema.parse(application.getPath(directory, OVERRIDE_MANIFEST)), manifestBody)
  providerRegistryService.clearCache()
}
