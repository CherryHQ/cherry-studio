import { application } from '@application'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { loggerService } from '@logger'
import { BaseService, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { envelopeMethodOf, secretCipher } from '@main/core/security/secretCipher'
import { eq } from 'drizzle-orm'

const logger = loggerService.withContext('ProviderCredentialSweepService')

export interface CredentialSweepResult {
  converted: number
  skipped: number
  /** At-rest envelope distribution across all scanned credential values. */
  envelopes: { ss: number; aes: number; plain: number; unknown: number }
}

/**
 * Boot-time migration for S7 at-rest encryption: converts legacy plaintext
 * provider credentials in user_provider to v1: envelopes. Idempotent — rows
 * already holding envelopes are skipped, so every boot is a cheap no-op once
 * the table is clean, and a restored plaintext backup is re-encrypted on the
 * next launch.
 *
 * WhenReady phase (no @DependsOn on DbService — the phase barrier already
 * orders AfterDb behind migrations/seeders, and WhenReady also guarantees
 * safeStorage availability on Windows). Renderer requests racing the sweep
 * are safe: better-sqlite3 runs on one synchronous connection and reads
 * pass prefix-less plaintext through unchanged, so a request landing before
 * the sweep reads correct plaintext and one after reads the decrypted envelope.
 */
@Injectable('ProviderCredentialSweepService')
@ServicePhase(Phase.WhenReady)
export class ProviderCredentialSweepService extends BaseService {
  protected override onReady(): void {
    try {
      const result = this.sweep()
      logger.info('Provider credential sweep done', result)
      logger.info('Secret storage backend', secretCipher.getReport())
    } catch (error) {
      // Boot must not break on a temporarily unavailable backend — rows stay
      // plaintext and the next boot retries (this sweep is idempotent).
      logger.error('Provider credential sweep failed; retrying next boot', { error })
    }
  }

  sweep(): CredentialSweepResult {
    return application.get('DbService').withWriteTx((tx) => {
      const rows = tx.select().from(userProviderTable).all()
      let converted = 0
      let skipped = 0
      const envelopes = { ss: 0, aes: 0, plain: 0, unknown: 0 }

      for (const row of rows) {
        const apiKeys = row.apiKeys ?? []
        for (const entry of apiKeys) {
          if (entry.key) envelopes[envelopeMethodOf(entry.key)] += 1
        }
        const auth = row.authConfig
        if (auth) {
          const secrets =
            auth.type === 'oauth'
              ? [auth.accessToken, auth.refreshToken]
              : auth.type === 'iam-aws'
                ? [auth.accessKeyId, auth.secretAccessKey]
                : auth.type === 'iam-gcp'
                  ? [auth.credentialsEnvelope, auth.credentials ? JSON.stringify(auth.credentials) : undefined]
                  : []
          for (const value of secrets) {
            if (value) envelopes[envelopeMethodOf(value)] += 1
          }
        }

        const needsKeys = secretCipher.needsEncryptionApiKeys(apiKeys)
        const needsAuth = secretCipher.needsEncryptionAuthConfig(auth)
        if (!needsKeys && !needsAuth) {
          skipped += 1
          continue
        }

        tx.update(userProviderTable)
          .set({
            ...(needsKeys ? { apiKeys: secretCipher.encryptApiKeys(apiKeys) } : {}),
            ...(needsAuth ? { authConfig: secretCipher.encryptAuthConfig(auth) } : {})
          })
          .where(eq(userProviderTable.providerId, row.providerId))
          .run()
        converted += 1
      }

      return { converted, skipped, envelopes }
    })
  }
}
