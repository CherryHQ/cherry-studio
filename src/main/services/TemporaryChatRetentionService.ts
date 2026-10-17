import { application } from '@application'
import { temporaryChatService } from '@data/services/TemporaryChatService'
import { topicService } from '@data/services/TopicService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'

@Injectable('TemporaryChatRetentionService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['AiStreamManager'])
export class TemporaryChatRetentionService extends BaseService {
  private sweeping = false

  protected async onReady(): Promise<void> {
    await this.expireTopics()
    // A minute of precision is enough for a 24-hour retention window.
    this.registerInterval(() => this.expireTopics(), 60_000)
  }

  async expireTopics(): Promise<void> {
    if (this.sweeping) return
    this.sweeping = true
    try {
      const now = Date.now()
      const ids = [...temporaryChatService.listExpiredTopicIds(now), ...topicService.listExpiredIds(now)]
      const streams = application.get('AiStreamManager')
      for (const id of ids) {
        await streams.withDispatchLock(id, async () => {
          const inMemory = temporaryChatService.isExpired(id, now)
          if (!inMemory && !topicService.isExpired(id, now)) return
          if (streams.hasUnsettledTopicWork(id)) {
            streams.abort(id, 'Temporary chat expired')
            return
          }
          if (inMemory) temporaryChatService.deleteTopic(id)
          else topicService.purgeExpired(id, now)
          application.get('IpcApiService').broadcast('quick_assistant.chat.expired', { topicIds: [id] })
        })
      }
    } finally {
      this.sweeping = false
    }
  }
}
