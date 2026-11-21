import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { t } from '@main/i18n'
import { transcodeToEntityWebp } from '@main/utils/image'
import type { InputFor } from '@shared/ipc/types'
import { Mutex } from '@shared/utils/async'

import { withCreatedImageEntry } from './entityImageBinding'

class AgentAvatarService {
  private readonly mutex = new Mutex()

  requireToolTarget(agentId: string): void {
    agentService.requireAvatarToolTargetTx(application.get('DbService').getDb(), agentId)
  }

  replaceWithBackup(agentId: string, image: Uint8Array, signal: AbortSignal): Promise<string> {
    return this.mutex.runExclusive(async () => {
      const dbService = application.get('DbService')
      signal.throwIfAborted()
      const name = await withCreatedImageEntry(image, 'delete_when_unreferenced', (fileId) => {
        signal.throwIfAborted()
        return dbService.withWriteTx((tx) => agentService.replaceAvatarWithBackupTx(tx, agentId, fileId))
      })
      agentService.notifyReadModelChange([agentId], 'projection')
      return name
    })
  }

  restoreBackup(agentId: string, signal: AbortSignal): Promise<string> {
    return this.mutex.runExclusive(async () => {
      const dbService = application.get('DbService')
      const db = dbService.getDb()
      signal.throwIfAborted()
      agentService.requireAvatarToolTargetTx(db, agentId)
      const backup = agentService.getAvatarBackupTx(db, agentId)
      if (!backup) throw new Error(t('agent.avatar_tool.no_backup'))
      if (backup.fileEntryId) {
        try {
          const { content } = await application.get('FileManager').read(backup.fileEntryId, { encoding: 'binary' })
          await transcodeToEntityWebp(content)
        } catch (error) {
          throw new Error(t('agent.avatar_tool.unreadable_backup'), { cause: error })
        }
      }
      signal.throwIfAborted()
      const name = dbService.withWriteTx((tx) => agentService.restoreAvatarBackupTx(tx, agentId, backup.id))
      agentService.notifyReadModelChange([agentId], 'projection')
      return name
    })
  }

  apply({ agentId, avatar }: InputFor<'agent.set_avatar'>): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const dbService = application.get('DbService')
      agentService.assertActiveTx(dbService.getDb(), agentId)
      if (avatar.kind === 'image') {
        await withCreatedImageEntry(avatar.data, 'delete_when_unreferenced', (fileId) => {
          dbService.withWriteTx((tx) => agentService.setAvatarSlotTx(tx, agentId, fileId))
        })
      } else {
        dbService.withWriteTx((tx) => {
          if (avatar.kind === 'emoji') agentService.setAvatarEmojiTx(tx, agentId, avatar.emoji)
          else {
            agentService.assertActiveTx(tx, agentId)
            agentService.clearAvatarSlotTx(tx, agentId)
          }
        })
      }
      agentService.notifyReadModelChange([agentId], 'projection')
    })
  }
}

export const agentAvatarService = new AgentAvatarService()
