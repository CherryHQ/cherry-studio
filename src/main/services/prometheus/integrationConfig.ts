import { randomBytes } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import { safeStorage } from 'electron'

import { application } from '@application'
import {
  integrationConfigSchema,
  integrationDocumentSchema,
  integrationRevisionsSchema,
  type IntegrationConfig,
  type IntegrationDocument,
  type IntegrationSecret,
  type IntegrationSecretPatch
} from '@shared/types/prometheusIntegration'

const INTEGRATION_PREFERENCE = 'app.prometheus.integrations' as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function upgradeIntegrationConfig(value: unknown): unknown {
  if (!isRecord(value) || !isRecord(value.services)) return value
  const services = value.services
  if (services.surrealdb || services.memory || services.liter) return value
  const ownership = services.mode === 'external' ? 'external' : 'managed'
  const source = ownership === 'managed' ? 'application' : 'manual'
  const surrealPort = typeof services.surrealPort === 'number' ? services.surrealPort : 28000
  const memoryPort = typeof services.memoryPort === 'number' ? services.memoryPort : 23001
  const literPort = typeof services.literPort === 'number' ? services.literPort : 4000
  const compass = isRecord(value.compass) ? value.compass : {}
  return {
    ...value,
    services: {
      ...services,
      surrealdb: {
        ownership,
        source,
        endpoint:
          ownership === 'external' && typeof compass.endpoint === 'string'
            ? compass.endpoint
            : `http://127.0.0.1:${surrealPort}`
      },
      memory: {
        ownership,
        source,
        endpoint:
          ownership === 'external' && typeof services.memoryEndpoint === 'string'
            ? services.memoryEndpoint
            : `http://127.0.0.1:${memoryPort}/mcp/sse`
      },
      liter: {
        ownership,
        source,
        endpoint:
          ownership === 'external' && typeof services.literEndpoint === 'string'
            ? services.literEndpoint
            : `http://127.0.0.1:${literPort}`
      }
    }
  }
}

function decodeIntegrationDocument(raw: string): { document: IntegrationDocument; legacy: boolean } {
  const value: unknown = JSON.parse(raw)
  const current = integrationDocumentSchema.safeParse(value)
  if (current.success) return { document: current.data, legacy: false }
  const wrapped = isRecord(value) && 'config' in value
  const config = integrationConfigSchema.parse(upgradeIntegrationConfig(wrapped ? value.config : value))
  const revisions = wrapped
    ? integrationRevisionsSchema.parse(value.revisions ?? {})
    : { compass: 0, filesystem: 0, uar: 0, services: 0 }
  return {
    document: {
      schemaVersion: 4,
      revisions,
      config
    },
    legacy: true
  }
}

export function readIntegrationDocument(): IntegrationDocument {
  return decodeIntegrationDocument(application.get('PreferenceService').get(INTEGRATION_PREFERENCE)).document
}

export async function migrateIntegrationDocument(): Promise<IntegrationDocument> {
  const decoded = decodeIntegrationDocument(application.get('PreferenceService').get(INTEGRATION_PREFERENCE))
  if (decoded.legacy) await writeIntegrationDocument(decoded.document)
  return decoded.document
}

export async function writeIntegrationDocument(document: IntegrationDocument): Promise<void> {
  const canonical = integrationDocumentSchema.parse(document)
  await application.get('PreferenceService').set(INTEGRATION_PREFERENCE, JSON.stringify(canonical))
}

export function readIntegrationConfig(): IntegrationConfig {
  return readIntegrationDocument().config
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

async function replaceSecrets(secrets: Partial<Record<IntegrationSecret, string>>): Promise<void> {
  if (
    !safeStorage.isEncryptionAvailable() ||
    (process.platform === 'linux' && safeStorage.getSelectedStorageBackend() === 'basic_text')
  ) {
    throw new Error('prometheus.error.secretStorage')
  }
  await fs.mkdir(integrationDirectory(), { recursive: true, mode: 0o700 })
  const filename = path.join(integrationDirectory(), 'secrets.enc')
  await fs.writeFile(`${filename}.tmp`, safeStorage.encryptString(JSON.stringify(secrets)), { mode: 0o600 })
  await fs.rename(`${filename}.tmp`, filename)
}

// Credentials cross the renderer/main boundary once. Ordinary preferences and responses
// contain only presence flags; disk storage uses the OS credential protection facility.
export async function writeSecrets(patch: IntegrationSecretPatch): Promise<void> {
  const secrets = await readSecrets()
  for (const [name, mutation] of Object.entries(patch) as Array<
    [IntegrationSecret, NonNullable<IntegrationSecretPatch[IntegrationSecret]>]
  >) {
    if (mutation.operation === 'set') secrets[name] = mutation.value
    if (mutation.operation === 'clear') delete secrets[name]
  }
  await replaceSecrets(secrets)
}

export async function ensureManagedSecrets(): Promise<Partial<Record<IntegrationSecret, string>>> {
  const secrets = await readSecrets()
  for (const key of ['rootPassword', 'memoryPassword', 'compassPassword', 'uarPassword', 'literKey'] as const) {
    if (!secrets[key]) secrets[key] = randomBytes(32).toString('hex')
  }
  await replaceSecrets(secrets)
  return secrets
}
