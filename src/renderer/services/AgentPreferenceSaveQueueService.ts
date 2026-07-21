import type { AgentEntity } from '@shared/data/api/schemas/agents'

type AgentPreferenceSave = () => Promise<AgentEntity | undefined>

class AgentPreferenceSaveQueueService {
  private readonly pendingSaves = new Map<string, Promise<boolean>>()

  /**
   * Serialize input-composer preference writes per Agent. Service lifetime intentionally spans
   * Session composer mounts, so a save started in one Session remains visible in the next.
   */
  enqueue(agentId: string, save: AgentPreferenceSave): Promise<boolean> {
    const previous = this.pendingSaves.get(agentId) ?? Promise.resolve(true)
    const queued = previous.then(async (previousSaved) => {
      try {
        return Boolean(await save()) && previousSaved
      } catch {
        return false
      }
    })
    this.pendingSaves.set(agentId, queued)

    const clearIfLatest = () => {
      if (this.pendingSaves.get(agentId) === queued) this.pendingSaves.delete(agentId)
    }
    void queued.then(clearIfLatest, clearIfLatest)

    return queued
  }

  /** Wait for the current save batch, including new writes, and preserve any failure in that batch. */
  async wait(agentId: string): Promise<boolean> {
    while (true) {
      const pending = this.pendingSaves.get(agentId)
      if (!pending) return true

      const saved = await pending

      const latest = this.pendingSaves.get(agentId)
      if (!latest || latest === pending) return saved
    }
  }
}

export const agentPreferenceSaveQueueService = new AgentPreferenceSaveQueueService()
