import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import type { InputFor } from '@shared/ipc/types'
import { Mutex } from '@shared/utils/async'

import { withCreatedImageEntry } from './entityImageBinding'

class AgentAvatarService {
  private readonly mutex = new Mutex()

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
