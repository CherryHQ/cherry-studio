import fs from 'node:fs/promises'

import { safeStorage } from 'electron'

import { application } from '@application'
import { type UarStorageConfig, uarStorageConfigSchema } from '@shared/types/prometheusIntegration'

export type AppliedUarStorage = {
  revision: number
  profile: UarStorageConfig
  password?: string
}

const filename = () => application.getPath('feature.agents.uar.data', 'storage-profile.enc')

export async function readAppliedUarStorage(): Promise<AppliedUarStorage> {
  try {
    const value = JSON.parse(safeStorage.decryptString(await fs.readFile(filename()))) as Partial<AppliedUarStorage>
    return {
      revision: Number.isSafeInteger(value.revision) && value.revision! >= 0 ? value.revision! : 0,
      profile: uarStorageConfigSchema.parse(value.profile),
      ...(typeof value.password === 'string' && value.password ? { password: value.password } : {})
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { revision: 0, profile: uarStorageConfigSchema.parse({ backend: 'embedded' }) }
    }
    throw error
  }
}

export async function writeAppliedUarStorage(storage: AppliedUarStorage): Promise<void> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('prometheus.error.secretStorage')
  }
  const target = filename()
  await fs.writeFile(`${target}.tmp`, safeStorage.encryptString(JSON.stringify(storage)), { mode: 0o600 })
  await fs.rename(`${target}.tmp`, target)
}
