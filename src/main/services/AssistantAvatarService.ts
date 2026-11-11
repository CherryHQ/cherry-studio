import { application } from '@application'
import { assistantDataService } from '@data/services/AssistantService'
import type { InputFor } from '@shared/ipc/types'
import { Mutex } from '@shared/utils/async'

import { withCreatedImageEntry } from './entityImageBinding'

class AssistantAvatarService {
  private readonly mutex = new Mutex()

  apply({ assistantId, avatar }: InputFor<'assistant.set_avatar'>): Promise<void> {
    return this.mutex.runExclusive(async () => {
      const dbService = application.get('DbService')
      assistantDataService.assertActiveTx(dbService.getDb(), assistantId)
      if (avatar.kind === 'image') {
        await withCreatedImageEntry(avatar.data, 'delete_when_unreferenced', (fileId) => {
          dbService.withWriteTx((tx) => assistantDataService.setAvatarSlotTx(tx, assistantId, fileId))
        })
      } else {
        dbService.withWriteTx((tx) => {
          if (avatar.kind === 'emoji') assistantDataService.setAvatarEmojiTx(tx, assistantId, avatar.emoji)
          else {
            assistantDataService.assertActiveTx(tx, assistantId)
            assistantDataService.clearAvatarSlotTx(tx, assistantId)
          }
        })
      }
      assistantDataService.notifyReadModelChange([assistantId], 'projection')
    })
  }
}

export const assistantAvatarService = new AssistantAvatarService()
