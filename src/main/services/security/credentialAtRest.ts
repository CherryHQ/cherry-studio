import { eq } from 'drizzle-orm'

import { application } from '@application'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'

import {
  encryptApiKeyEntries,
  encryptAuthConfig,
  encryptSecretRecord,
  hasPlaintextSecret,
  isEncryptedSecret,
  isSecretStorageAvailable
} from './secretStorage'

const logger = loggerService.withContext('CredentialAtRest')

/**
 * Rewrite credentials saved by older builds into the encrypted-at-rest format.
 * Idempotent: already-encrypted values are left alone, and the scan runs only
 * after Electron's app-ready phase where safeStorage can reach the OS keyring.
 */
export function encryptLegacyCredentialsAtRest(): void {
  if (!isSecretStorageAvailable()) {
    logger.warn('OS credential encryption is unavailable; legacy credentials stay in plaintext')
    return
  }

  const db = application.get('DbService')
  let providers = 0
  let mcpServers = 0

  db.withWriteTx((tx) => {
    for (const row of tx
      .select({
        providerId: userProviderTable.providerId,
        apiKeys: userProviderTable.apiKeys,
        authConfig: userProviderTable.authConfig
      })
      .from(userProviderTable)
      .all()) {
      const apiKeys = row.apiKeys ?? []
      const keysChanged = apiKeys.some((entry) => entry.key && !isEncryptedSecret(entry.key))
      const authConfig = encryptAuthConfig(row.authConfig)
      const authChanged = JSON.stringify(authConfig) !== JSON.stringify(row.authConfig)
      if (!keysChanged && !authChanged) continue
      tx.update(userProviderTable)
        .set({
          apiKeys: encryptApiKeyEntries(apiKeys),
          authConfig: authConfig ?? null
        })
        .where(eq(userProviderTable.providerId, row.providerId))
        .run()
      providers++
    }

    for (const row of tx
      .select({ id: mcpServerTable.id, env: mcpServerTable.env, headers: mcpServerTable.headers })
      .from(mcpServerTable)
      .all()) {
      if (!hasPlaintextSecret(row.env) && !hasPlaintextSecret(row.headers)) continue
      tx.update(mcpServerTable)
        .set({
          env: encryptSecretRecord(row.env) ?? null,
          headers: encryptSecretRecord(row.headers) ?? null
        })
        .where(eq(mcpServerTable.id, row.id))
        .run()
      mcpServers++
    }
  })

  if (providers || mcpServers) {
    logger.info('Encrypted legacy credentials at rest', { providers, mcpServers })
  }
}
