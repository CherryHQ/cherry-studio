import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  createSession: vi.fn(),
  ensureAssistant: vi.fn()
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: { create: mocks.createSession }
}))
vi.mock('../ensureBuiltinAssistant', () => ({
  ensureBuiltinAssistant: mocks.ensureAssistant
}))

import { createBuiltinAssistantFeedbackSession } from '../createBuiltinAssistantFeedbackSession'

describe('createBuiltinAssistantFeedbackSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.ensureAssistant.mockReturnValue({ id: 'assistant-1' })
    mocks.createSession.mockReturnValue({ id: 'session-1', agentId: 'assistant-1' })
  })

  it('restores the built-in assistant and creates a fresh system session', () => {
    expect(createBuiltinAssistantFeedbackSession()).toEqual({ id: 'session-1', agentId: 'assistant-1' })
    expect(mocks.ensureAssistant).toHaveBeenCalledOnce()
    expect(mocks.createSession).toHaveBeenCalledWith({
      agentId: 'assistant-1',
      name: '',
      workspace: { type: 'system' }
    })
  })
})
