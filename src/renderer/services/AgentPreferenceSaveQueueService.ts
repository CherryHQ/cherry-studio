import type { AgentEntity } from '@shared/data/api/schemas/agents'

type AgentPreferenceSave = () => Promise<AgentEntity | undefined>

class AgentPreferenceSaveQueueService {
  private readonly pendingSaves = new Map<string, Promise<AgentEntity | undefined>>()

  /**
   * Serialize input-composer preference writes per Agent. Service lifetime intentionally spans
   * Session composer mounts, so a save started in one Session remains visible in the next.
   */
  enqueue(agentId: string, save: AgentPreferenceSave): Promise<boolean> {
    const previous = this.pendingSaves.get(agentId)
    const queued = previous ? previous.then(save, save) : Promise.resolve().then(save)
    this.pendingSaves.set(agentId, queued)

    const clearIfLatest = () => {
      if (this.pendingSaves.get(agentId) === queued) this.pendingSaves.delete(agentId)
    }
    void queued.then(clearIfLatest, clearIfLatest)

    return queued.then(Boolean, () => false)
  }

  /** Wait for the latest preference write, including writes queued while this call is waiting. */
  async wait(agentId: string): Promise<boolean> {
    while (true) {
      const pending = this.pendingSaves.get(agentId)
      if (!pending) return true

      let saved = false
      try {
        saved = Boolean(await pending)
      } catch {
        saved = false
      }

      const latest = this.pendingSaves.get(agentId)
      if (!latest || latest === pending) return saved
    }
  }
}

export const agentPreferenceSaveQueueService = new AgentPreferenceSaveQueueService()
