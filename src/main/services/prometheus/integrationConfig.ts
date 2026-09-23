import fs from 'node:fs/promises'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { safeStorage } from 'electron'
import { application } from '@application'
import { integrationConfigSchema, type IntegrationConfig, type IntegrationSecret } from '@shared/types/prometheusIntegration'

export function readIntegrationConfig(): IntegrationConfig {
  return integrationConfigSchema.parse(JSON.parse(application.get('PreferenceService').get('app.prometheus.integrations')))
}

export function integrationDirectory(): string {
  return application.getPath('feature.prometheus.state')
}

export async function readSecrets(): Promise<Partial<Record<IntegrationSecret, string>>> {
  try {
    const data = await fs.readFile(path.join(integrationDirectory(), 'secrets.enc'))
    return JSON.parse(safeStorage.decryptString(data))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return {}
    throw error
  }
}

// Credentials cross the renderer/main boundary once. Ordinary preferences and responses
// contain only presence flags; disk storage uses the OS credential protection facility.
export async function writeSecrets(patch: Partial<Record<IntegrationSecret, string>>): Promise<void> {
  if (!safeStorage.isEncryptionAvailable() || (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')) {
    throw new Error('prometheus.error.secretStorage')
  }
  const secrets = { ...await readSecrets(), ...patch }
  await fs.mkdir(integrationDirectory(), { recursive: true, mode: 0o700 })
  const filename = path.join(integrationDirectory(), 'secrets.enc')
  await fs.writeFile(`${filename}.tmp`, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 })
  await fs.rename(`${filename}.tmp`, filename)
}

export async function ensureManagedSecrets(): Promise<Partial<Record<IntegrationSecret, string>>> {
  const secrets = await readSecrets()
  for (const key of ['rootPassword', 'memoryPassword', 'compassPassword', 'literKey'] as const) {
    if (!secrets[key]) secrets[key] = randomBytes(32).toString('hex')
  }
  await writeSecrets(secrets)
  return secrets
}
