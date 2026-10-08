import { setupTestDatabase } from '@test-helpers/db'
import { describe, expect, it } from 'vitest'

import { agentChannelService } from '../AgentChannelService'

const input = {
  type: 'dingtalk' as const,
  name: 'DingTalk',
  workspace: { type: 'system' as const },
  config: { client_id: 'bot', robot_code: 'robot', client_secret: 'secret', allowed_chat_ids: [], allowed_user_ids: [] }
}
describe('DingTalk bot exclusivity', () => {
  setupTestDatabase()

  it('rejects duplicate activation across create/update while preserving drafts and existing rows', () => {
    const first = agentChannelService.createChannel(input)
    expect(() => agentChannelService.createChannel(input)).toThrow()
    const draft = agentChannelService.createChannel({ ...input, isActive: false })
    expect(() => agentChannelService.updateChannel(draft.id, { isActive: true })).toThrow()
    expect(agentChannelService.getChannel(draft.id)?.isActive).toBe(false)
    agentChannelService.updateChannel(first.id, { isActive: false })
    expect(agentChannelService.updateChannel(draft.id, { isActive: true })?.isActive).toBe(true)
  })

  it('validates and normalizes allowlists, preserving the secret bytes', () => {
    const created = agentChannelService.createChannel({
      ...input,
      config: {
        ...input.config,
        client_id: ' bot ',
        client_secret: ' secret ',
        allowed_chat_ids: [' dm:alice ', 'dm:alice'],
        allowed_user_ids: [' alice ', 'alice']
      }
    })
    expect(created.config).toEqual({
      client_id: 'bot',
      robot_code: 'robot',
      client_secret: ' secret ',
      allowed_chat_ids: ['dm:alice'],
      allowed_user_ids: ['alice']
    })
    expect(() =>
      agentChannelService.updateChannel(created.id, { config: { ...input.config, allowed_chat_ids: ['unscoped-id'] } })
    ).toThrow()
    expect(agentChannelService.getChannel(created.id)?.config).toEqual(created.config)
  })

  it('allows incomplete drafts but rejects activating missing credentials', () => {
    const draft = agentChannelService.createChannel({
      ...input,
      isActive: false,
      config: { ...input.config, client_secret: '' }
    })
    expect(() => agentChannelService.updateChannel(draft.id, { isActive: true })).toThrow()
    expect(agentChannelService.getChannel(draft.id)?.isActive).toBe(false)
  })
})
