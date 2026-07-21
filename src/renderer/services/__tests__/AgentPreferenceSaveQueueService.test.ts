import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { describe, expect, it } from 'vitest'

import { agentPreferenceSaveQueueService } from '../AgentPreferenceSaveQueueService'

describe('AgentPreferenceSaveQueueService', () => {
  it('preserves an earlier failure across the current save batch', async () => {
    const agentId = 'agent-with-failed-preference-save'
    const first = agentPreferenceSaveQueueService.enqueue(agentId, async () => undefined)
    const second = agentPreferenceSaveQueueService.enqueue(agentId, async () => ({ id: agentId }) as AgentEntity)

    expect(await agentPreferenceSaveQueueService.wait(agentId)).toBe(false)
    expect(await Promise.all([first, second])).toEqual([false, false])
    expect(await agentPreferenceSaveQueueService.wait(agentId)).toBe(true)
  })
})
