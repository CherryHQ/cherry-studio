import { describe, expect, it } from 'vitest'

import { ActiveAgentChannelConfigSchemasByType, AgentChannelConfigSchemasByType } from '../agentChannels'

describe('Telegram agent channel config', () => {
  const base = { bot_token: 'token' }

  it('accepts topic bindings keyed by chatId:threadId', () => {
    const parsed = AgentChannelConfigSchemasByType.telegram.parse({
      ...base,
      topic_agents: { '-1001234567890:7': 'agent-research' }
    })
    expect(parsed.topic_agents).toEqual({ '-1001234567890:7': 'agent-research' })
  })

  it.each(['7', 'chat:7', '-1001234567890:', '-1001234567890:7:8'])('rejects topic key %s', (key) => {
    const result = AgentChannelConfigSchemasByType.telegram.safeParse({
      ...base,
      topic_agents: { [key]: 'agent-research' }
    })
    expect(result.success).toBe(false)
  })

  it('rejects an empty agent id for a topic', () => {
    const result = ActiveAgentChannelConfigSchemasByType.telegram.safeParse({
      ...base,
      topic_agents: { '-1001234567890:7': '' }
    })
    expect(result.success).toBe(false)
  })
})
