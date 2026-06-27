import { CHERRYAI_DEFAULT_UNIQUE_MODEL_ID } from '@shared/data/presets/cherryai'
import { MockMainCacheServiceUtils } from '@test-mocks/main/CacheService'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { mockMainLoggerService } from '@test-mocks/MainLoggerService'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(),
  broadcast: vi.fn(),
  getTopic: vi.fn(),
  updateTopic: vi.fn(),
  getMessageById: vi.fn(),
  getModelByKey: vi.fn(),
  getAgent: vi.fn(),
  getSession: vi.fn(),
  updateSession: vi.fn()
}))

vi.mock('@main/core/application', async () => {
  const { mockApplicationFactory } = await import('@test-mocks/main/application')
  return mockApplicationFactory({
    AiService: { generateText: mocks.generateText },
    WindowManager: { broadcast: mocks.broadcast }
  } as never)
})

vi.mock('@data/services/TopicService', () => ({
  topicService: {
    getById: mocks.getTopic,
    update: mocks.updateTopic
  }
}))

vi.mock('@main/data/services/MessageService', () => ({
  messageService: {
    getById: mocks.getMessageById
  }
}))

vi.mock('@data/services/ModelService', () => ({
  modelService: {
    getByKey: mocks.getModelByKey
  }
}))

vi.mock('@data/services/AgentService', () => ({
  agentService: {
    getAgent: mocks.getAgent
  }
}))

vi.mock('@data/services/AgentSessionService', () => ({
  agentSessionService: {
    getById: mocks.getSession,
    update: mocks.updateSession
  }
}))

const { TopicNamingService } = await import('../TopicNamingService')

function createService() {
  return new TopicNamingService()
}

function mockRenameInputs() {
  mocks.getTopic.mockResolvedValue({
    id: 'topic-1',
    name: 'Old Topic',
    isNameManuallyEdited: false
  })
  mocks.getMessageById.mockResolvedValue({
    id: 'message-1',
    role: 'user',
    data: { parts: [{ type: 'text', text: 'Hello there' }] }
  })
  mocks.generateText.mockResolvedValue({ text: 'Generated Title' })
}

describe('TopicNamingService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockMainPreferenceServiceUtils.resetMocks()
    MockMainCacheServiceUtils.resetMocks()
    mockMainLoggerService.warn.mockClear()
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.enabled', true)
    mocks.getModelByKey.mockResolvedValue({ id: 'openai::gpt-4o-mini' })
    mockRenameInputs()
  })

  it('uses topic.naming.model_id for normal chat summary naming', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.model_id', 'openai::gpt-4o-mini')

    await createService().maybeRenameFromConversationSummary('topic-1', 'assistant-1', 'message-1', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Assistant response' }]
    } as never)

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: 'assistant-1',
        uniqueModelId: 'openai::gpt-4o-mini'
      })
    )
    expect(mocks.updateTopic).toHaveBeenCalledWith('topic-1', { name: 'Generated Title' })
  })

  it('falls back to the managed CherryAI default when topic naming model preference is empty', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.model_id', null)

    await createService().maybeRenameFromConversationSummary('topic-1', undefined, 'message-1', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Assistant response' }]
    } as never)

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: undefined,
        uniqueModelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    )
  })

  it('falls back to the managed CherryAI default when topic naming model preference is invalid', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.model_id', 'bad-value')

    await createService().maybeRenameFromConversationSummary('topic-1', undefined, 'message-1', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Assistant response' }]
    } as never)

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        uniqueModelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    )
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'topic.naming.model_id is invalid; falling back to managed CherryAI default model',
      { configured: 'bad-value' }
    )
  })

  it('falls back to the managed CherryAI default when topic naming model no longer exists', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.model_id', 'ghost::missing')
    mocks.getModelByKey.mockRejectedValue(new Error('missing model'))

    await createService().maybeRenameFromConversationSummary('topic-1', undefined, 'message-1', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Assistant response' }]
    } as never)

    expect(mocks.getModelByKey).toHaveBeenCalledWith('ghost', 'missing')
    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        uniqueModelId: CHERRYAI_DEFAULT_UNIQUE_MODEL_ID
      })
    )
    expect(mockMainLoggerService.warn).toHaveBeenCalledWith(
      'topic.naming.model_id points to a missing model; falling back to managed CherryAI default model',
      { configured: 'ghost::missing' }
    )
  })

  it('uses topic.naming.model_id for agent session summary naming', async () => {
    MockMainPreferenceServiceUtils.setPreferenceValue('topic.naming.model_id', 'openai::gpt-4o-mini')
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'common.unnamed',
      isNameManuallyEdited: false
    })

    await createService().maybeRenameAgentSession('agent-1', 'session-1', 'User request', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Agent response' }]
    } as never)

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        assistantId: 'agent-1',
        uniqueModelId: 'openai::gpt-4o-mini'
      })
    )
    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
      name: 'Generated Title',
      isNameManuallyEdited: false
    })
  })

  it('renames default unnamed agent sessions from the first user message without generating a summary', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: '未命名',
      isNameManuallyEdited: false
    })
    mocks.updateSession.mockResolvedValue({ id: 'session-1' })

    await createService().maybeRenameAgentSessionFromFirstUserMessage(
      'session-1',
      'Please inspect the renderer startup path and suggest fixes'
    )

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
      name: 'Please inspect the renderer startup path and sugge',
      isNameManuallyEdited: false
    })
    expect(mocks.broadcast).toHaveBeenCalledWith('agent-session:auto-renamed', { sessionId: 'session-1' })
  })

  it('extracts first-message agent session names from message data', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: '未命名',
      isNameManuallyEdited: false
    })
    mocks.updateSession.mockResolvedValue({ id: 'session-1' })

    await createService().maybeRenameAgentSessionFromFirstUserMessage('session-1', {
      parts: [
        { type: 'text', text: '  Inspect renderer startup  ' },
        { type: 'file', url: 'file://trace.log', mediaType: 'text/plain' },
        { type: 'text', text: 'suggest fixes' }
      ]
    } as never)

    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
      name: 'Inspect renderer startup suggest fixes',
      isNameManuallyEdited: false
    })
  })

  it('does not first-message rename an agent session that already has a real title', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Release planning',
      isNameManuallyEdited: true
    })

    await createService().maybeRenameAgentSessionFromFirstUserMessage('session-1', 'New user text')

    expect(mocks.updateSession).not.toHaveBeenCalled()
    expect(mocks.broadcast).not.toHaveBeenCalled()
  })

  it('does not summary-rename agent sessions that already have a real title', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'Release planning',
      isNameManuallyEdited: true
    })

    await createService().maybeRenameAgentSession('agent-1', 'session-1', 'User request', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Agent response' }]
    } as never)

    expect(mocks.generateText).not.toHaveBeenCalled()
    expect(mocks.updateSession).not.toHaveBeenCalled()
  })

  it('allows summary rename after the first-message temporary agent session title', async () => {
    mocks.getSession.mockResolvedValue({
      id: 'session-1',
      agentId: 'agent-1',
      name: 'User request',
      isNameManuallyEdited: false
    })

    await createService().maybeRenameAgentSession('agent-1', 'session-1', 'User request', {
      role: 'assistant',
      parts: [{ type: 'text', text: 'Agent response' }]
    } as never)

    expect(mocks.updateSession).toHaveBeenCalledWith('session-1', {
      name: 'Generated Title',
      isNameManuallyEdited: false
    })
  })
})
