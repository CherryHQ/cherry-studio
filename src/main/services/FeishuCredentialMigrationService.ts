import { eq } from 'drizzle-orm'

import { application } from '@application'
import { agentChannelTable } from '@data/db/schemas/agentChannel'
import { externalKnowledgeConnectionTable } from '@data/db/schemas/externalKnowledgeConnection'
import { loggerService } from '@logger'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import { legacyFeishuCredentialStore } from '@main/services/LegacyFeishuCredentialStore'
import { CredentialIdSchema } from '@shared/types/credential'

import { migrateFeishuCredentials } from './migrateFeishuCredentials'

const logger = loggerService.withContext('FeishuCredentialMigrationService')

@Injectable('FeishuCredentialMigrationService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['CredentialStoreService'])
export class FeishuCredentialMigrationService extends BaseService {
  protected async onInit(): Promise<void> {
    const result = await migrateFeishuCredentials(
      application.get('CredentialStoreService'),
      legacyFeishuCredentialStore
    )
    for (const channelId of result.blockedChannels) {
      application.get('CacheService').setShared(`channel.status.${channelId}`, {
        channelId,
        connected: false,
        error: t('common.feishu_credential_migration_failed')
      })
    }
    logger.info('Feishu credential migration finished', result)
  }

  isConnectionBlocked(id: string): boolean {
    const row = application
      .get('DbService')
      .getDb()
      .select({ reference: externalKnowledgeConnectionTable.credentialReference })
      .from(externalKnowledgeConnectionTable)
      .where(eq(externalKnowledgeConnectionTable.id, id))
      .get()
    return Boolean(row && !CredentialIdSchema.safeParse(row.reference).success)
  }

  isChannelBlocked(id: string): boolean {
    const row = application
      .get('DbService')
      .getDb()
      .select({ config: agentChannelTable.config })
      .from(agentChannelTable)
      .where(eq(agentChannelTable.id, id))
      .get()
    return Boolean(row && !('applicationCredentialId' in row.config))
  }
}
