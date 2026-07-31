import { aiErrorCodes } from '@shared/ipc/errors/ai'
import { IpcError } from '@shared/ipc/errors/IpcError'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { appGetMock, agentSessionMessageService, messageService, createAgent } = vi.hoisted(() => ({
  appGetMock: vi.fn(),
  agentSessionMessageService: { getSessionMessage: vi.fn() },
  messageService: { getById: vi.fn() },
  createAgent: vi.fn()
}))
vi.mock('@application', () => ({ application: { get: appGetMock } }))
vi.mock('@data/services/AgentSessionMessageService', () => ({ agentSessionMessageService }))
vi.mock('@data/services/MessageService', () => ({ messageService }))
vi.mock('@main/ai/agents/createAgent', () => ({ createAgent }))

import { aiHandlers } from '../ai'

const aiService = {
  generateText: vi.fn(),
  runTextRequest: vi.fn(),
  abortText: vi.fn(),
  checkModel: vi.fn(),
  embedMany: vi.fn(),
  runImageRequest: vi.fn(),
  abortImage: vi.fn(),
  listModels: vi.fn(),
  respondToolApproval: vi.fn()
}

const aiStreamManager = {
  dispatch: vi.fn(),
  attach: vi.fn(),
  detach: vi.fn(),
  abort: vi.fn(),
  getDeferredToolOutput: vi.fn()
}

/** A settled tool part as the persistence layer actually stores it. */
const toolPart = (toolCallId: string, output: unknown) => ({
  type: 'dynamic-tool',
  toolName: 'Read',
  toolCallId,
  state: 'output-available',
  input: {},
  output
})

const claudeCodeWarmQueryManager = { prewarmAgentSession: vi.fn(), closeAgentSessionWarm: vi.fn() }
const agentSessionRuntimeService = { primeConnection: vi.fn(), releaseIdleConnection: vi.fn() }
const claudeCodeTraceBridgeService = { isTraceModeEnabled: vi.fn() }
const agentJobsService = {
  createTask: vi.fn(),
  updateTask: vi.fn(),
  pauseTask: vi.fn(),
  resumeTask: vi.fn(),
  deleteTask: vi.fn(),
  runTask: vi.fn()
}

// WebContentsListener (constructed in the stream_open handler) wires once()/isDestroyed().
const fakeWebContents = { id: 1, once: vi.fn(), isDestroyed: () => false, send: vi.fn() }
const windowManager = { getWindow: vi.fn() }

beforeEach(() => {
  vi.clearAllMocks()
  createAgent.mockImplementation(async (request: object) => ({ id: 'agent-1', ...request }))
  windowManager.getWindow.mockReturnValue({ webContents: fakeWebContents })
  appGetMock.mockImplementation((name: string) => {
    switch (name) {
      case 'AiService':
        return aiService
      case 'AiStreamManager':
        return aiStreamManager
      case 'ClaudeCodeWarmQueryManager':
        return claudeCodeWarmQueryManager
      case 'AgentSessionRuntimeService':
        return agentSessionRuntimeService
      case 'ClaudeCodeTraceBridgeService':
        return claudeCodeTraceBridgeService
      case 'AgentJobsService':
        return agentJobsService
      case 'WindowManager':
        return windowManager
      default:
        throw new Error(`Unexpected application.get(${name})`)
    }
  })
})

// AI handlers act on provider/model capabilities, not the caller's window, so they
// ignore IpcContext — pass a stable stub.
const ctx = { senderId: 'w1' }

describe('aiHandlers', () => {
  it('generate_text forwards the request and returns the AiService result', async () => {
    const request = { uniqueModelId: 'openai::gpt-4o', system: 'sys', prompt: 'hi' } as const
    const out = { text: 'hello', usage: { inputTokens: 1, outputTokens: 2 } }
    aiService.generateText.mockResolvedValue(out)

    const result = await aiHandlers['ai.text.generate'](request, ctx)

    expect(aiService.generateText).toHaveBeenCalledWith(request)
    expect(result).toBe(out)
  })

  it('generate_text registers cancellable requests by id', async () => {
    const request = {
      requestId: 'greeting-1',
      uniqueModelId: 'openai::gpt-4o',
      system: 'sys',
      prompt: 'hi'
    } as const
    const out = { text: 'hello' }
    aiService.runTextRequest.mockResolvedValue(out)

    const result = await aiHandlers['ai.text.generate'](request, ctx)

    expect(aiService.runTextRequest).toHaveBeenCalledWith('greeting-1', {
      uniqueModelId: 'openai::gpt-4o',
      system: 'sys',
      prompt: 'hi'
    })
    expect(aiService.generateText).not.toHaveBeenCalled()
    expect(result).toBe(out)
  })

  it('abort_text delegates to AiService.abortText and resolves void', async () => {
    const result = await aiHandlers['ai.text.abort']({ requestId: 'greeting-1' }, ctx)
    expect(aiService.abortText).toHaveBeenCalledWith('greeting-1')
    expect(result).toBeUndefined()
  })

  it('check_model forwards the request and returns latency', async () => {
    aiService.checkModel.mockResolvedValue({ latency: 42 })
    const request = { uniqueModelId: 'openai::gpt-4o', apiKeyOverride: 'sk-selected', timeout: 5000 } as const
    const result = await aiHandlers['ai.provider.model.check'](request, ctx)
    expect(aiService.checkModel).toHaveBeenCalledWith(request)
    expect(result).toEqual({ latency: 42 })
  })

  it('embed_many forwards the request and returns embeddings', async () => {
    const out = { embeddings: [[0, 1]] }
    aiService.embedMany.mockResolvedValue(out)
    const result = await aiHandlers['ai.embedding.embed_many']({ uniqueModelId: 'openai::e', values: ['a'] }, ctx)
    expect(aiService.embedMany).toHaveBeenCalledWith({ uniqueModelId: 'openai::e', values: ['a'] })
    expect(result).toBe(out)
  })

  it('generate_image unwraps { requestId, payload } into runImageRequest', async () => {
    const payload = { uniqueModelId: 'openai::img' as const, prompt: 'a fox', paramValues: {} }
    const out = { files: [] }
    aiService.runImageRequest.mockResolvedValue(out)

    const result = await aiHandlers['ai.image.generate']({ requestId: 'r1', payload }, ctx)

    expect(aiService.runImageRequest).toHaveBeenCalledWith('r1', payload)
    expect(result).toBe(out)
  })

  it('abort_image delegates to AiService.abortImage and resolves void', async () => {
    const result = await aiHandlers['ai.image.abort']({ requestId: 'r1' }, ctx)
    expect(aiService.abortImage).toHaveBeenCalledWith('r1')
    expect(result).toBeUndefined()
  })

  it('list_models forwards the request and returns the models', async () => {
    const models = [{ id: 'openai::gpt-4o' }]
    aiService.listModels.mockResolvedValue(models)
    const result = await aiHandlers['ai.provider.model.list']({ providerId: 'openai', throwOnError: true }, ctx)
    expect(aiService.listModels).toHaveBeenCalledWith({ providerId: 'openai', throwOnError: true })
    expect(result).toBe(models)
  })

  // The point of the migration: a provider failure is re-thrown as an AI_REQUEST_FAILED
  // IpcError that carries the full SerializedError in `data`, so the renderer can read
  // detail Electron's invoke reject would otherwise drop.
  it('wraps a provider failure as an AI_REQUEST_FAILED IpcError carrying the serialized error', async () => {
    const failure = Object.assign(new Error('401 Unauthorized'), { statusCode: 401, responseBody: 'bad key' })
    aiService.generateText.mockRejectedValue(failure)

    const error = await aiHandlers['ai.text.generate']({ uniqueModelId: 'openai::gpt-4o', prompt: 'hi' }, ctx).catch(
      (e) => e
    )

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.message).toBe('401 Unauthorized')
    // data is the SerializedError — provider detail survives the boundary.
    expect(error.data).toMatchObject({ message: '401 Unauthorized', statusCode: 401, responseBody: 'bad key' })
  })

  it('normalizes a non-Error throw into an AI_REQUEST_FAILED IpcError', async () => {
    aiService.checkModel.mockRejectedValue('boom')

    const error = await aiHandlers['ai.provider.model.check']({ uniqueModelId: 'openai::gpt-4o' }, ctx).catch((e) => e)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_REQUEST_FAILED)
    expect(error.message).toBe('boom')
  })
})

describe('aiHandlers — streaming', () => {
  it('stream_open resolves the sender WebContents and dispatches to AiStreamManager', async () => {
    const req = { trigger: 'submit-message', topicId: 't', userMessageParts: [] } as never
    aiStreamManager.dispatch.mockResolvedValue({ mode: 'started' })

    const result = await aiHandlers['ai.stream.open'](req, { senderId: 'w1' })

    expect(windowManager.getWindow).toHaveBeenCalledWith('w1')
    expect(aiStreamManager.dispatch).toHaveBeenCalledTimes(1)
    // Second arg is the parsed request; first is the freshly built WebContentsListener.
    expect(aiStreamManager.dispatch.mock.calls[0][1]).toBe(req)
    expect(result).toEqual({ mode: 'started' })
  })

  it('stream_open throws when the sender is not a managed window', async () => {
    windowManager.getWindow.mockReturnValue(undefined)
    await expect(aiHandlers['ai.stream.open']({ topicId: 't' } as never, { senderId: null })).rejects.toThrow(
      'requires a managed window'
    )
    expect(aiStreamManager.dispatch).not.toHaveBeenCalled()
  })

  it('stream_attach delegates to AiStreamManager.attach and returns its response', async () => {
    aiStreamManager.attach.mockReturnValue({ status: 'not-found' })

    const result = await aiHandlers['ai.stream.attach']({ topicId: 't' }, { senderId: 'w1' })

    expect(aiStreamManager.attach).toHaveBeenCalledWith(fakeWebContents, { topicId: 't' })
    expect(result).toEqual({ status: 'not-found' })
  })

  it('stream_attach throws when the sender is not a managed window', async () => {
    windowManager.getWindow.mockReturnValue(undefined)
    await expect(aiHandlers['ai.stream.attach']({ topicId: 't' }, { senderId: null })).rejects.toThrow(
      'requires a managed window'
    )
    expect(aiStreamManager.attach).not.toHaveBeenCalled()
  })

  it('stream_detach delegates when the sender window exists', async () => {
    await aiHandlers['ai.stream.detach']({ topicId: 't' }, { senderId: 'w1' })
    expect(aiStreamManager.detach).toHaveBeenCalledWith(fakeWebContents, { topicId: 't' })
  })

  it('stream_detach is a no-op when the sender window is gone', async () => {
    windowManager.getWindow.mockReturnValue(undefined)
    await aiHandlers['ai.stream.detach']({ topicId: 't' }, { senderId: 'w1' })
    expect(aiStreamManager.detach).not.toHaveBeenCalled()
  })

  it('stream_abort aborts the topic without resolving a WebContents', async () => {
    await aiHandlers['ai.stream.abort']({ topicId: 't' }, { senderId: null })
    expect(aiStreamManager.abort).toHaveBeenCalledWith('t', 'user-requested')
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })

  it('get_tool_result prefers the active stream over the persisted copy', async () => {
    const output = { content: 'large live output' }
    aiStreamManager.getDeferredToolOutput.mockReturnValue({ found: true, output })

    const result = await aiHandlers['ai.tool.get_result'](
      { topicId: 'agent-session:session-1', messageId: 'assistant-1', toolCallId: 'call-1' },
      { senderId: null }
    )

    expect(aiStreamManager.getDeferredToolOutput).toHaveBeenCalledWith('agent-session:session-1', 'call-1')
    expect(agentSessionMessageService.getSessionMessage).not.toHaveBeenCalled()
    expect(result).toEqual({ found: true, output })
  })

  it('get_tool_result falls back to the stored agent-session message', async () => {
    const output = { content: 'large stored output' }
    aiStreamManager.getDeferredToolOutput.mockReturnValue({ found: false })
    agentSessionMessageService.getSessionMessage.mockReturnValue({
      data: { parts: [toolPart('call-1', output)] }
    })

    const result = await aiHandlers['ai.tool.get_result'](
      { topicId: 'agent-session:session-1', messageId: 'assistant-1', toolCallId: 'call-1' },
      { senderId: null }
    )

    expect(agentSessionMessageService.getSessionMessage).toHaveBeenCalledWith('session-1', 'assistant-1')
    expect(result).toEqual({ found: true, output })
  })

  it('get_tool_result resolves an ordinary chat topic through the message table', async () => {
    const output = { content: 'large chat output' }
    aiStreamManager.getDeferredToolOutput.mockReturnValue({ found: false })
    messageService.getById.mockReturnValue({ data: { parts: [toolPart('call-1', output)] } })

    const result = await aiHandlers['ai.tool.get_result'](
      { topicId: 'topic-42', messageId: 'assistant-1', toolCallId: 'call-1' },
      { senderId: null }
    )

    expect(messageService.getById).toHaveBeenCalledWith('assistant-1')
    expect(result).toEqual({ found: true, output })
  })

  it('get_tool_result reports a miss instead of throwing when nothing holds the output', async () => {
    aiStreamManager.getDeferredToolOutput.mockReturnValue({ found: false })
    messageService.getById.mockImplementation(() => {
      throw new Error('not found')
    })

    await expect(
      aiHandlers['ai.tool.get_result'](
        { topicId: 'topic-42', messageId: 'gone', toolCallId: 'call-1' },
        { senderId: null }
      )
    ).resolves.toEqual({ found: false })
  })
})

describe('aiHandlers — agent sessions & tasks', () => {
  it('delegates Agent creation to the owning operation', async () => {
    const request = {
      type: 'claude-code' as const,
      name: 'Test',
      model: 'anthropic::claude-sonnet' as const
    }
    const agent = { id: 'agent-1', ...request }
    createAgent.mockResolvedValue(agent)

    await expect(aiHandlers['ai.agent.create'](request, ctx)).resolves.toBe(agent)
    expect(createAgent).toHaveBeenCalledWith(request, ctx)
  })

  it('prewarm_agent_session primes the session connection so commands load before the first turn', async () => {
    agentSessionRuntimeService.primeConnection.mockResolvedValue(undefined)
    await aiHandlers['ai.agent.session.prewarm']({ sessionId: 's1' }, ctx)
    expect(agentSessionRuntimeService.primeConnection).toHaveBeenCalledWith('s1')
  })

  // Trace mode used to skip this, inherited from the warm-query era. A primed connection carries the
  // session's traceparent like any other, so skipping only cost developer mode its eager catalog.
  it('prewarm_agent_session primes the connection in trace mode too', async () => {
    claudeCodeTraceBridgeService.isTraceModeEnabled.mockReturnValue(true)
    agentSessionRuntimeService.primeConnection.mockResolvedValue(undefined)
    await aiHandlers['ai.agent.session.prewarm']({ sessionId: 's1' }, ctx)
    expect(agentSessionRuntimeService.primeConnection).toHaveBeenCalledWith('s1')
  })

  it('close_agent_session_warm releases the warm query and the primed connection', async () => {
    await aiHandlers['ai.agent.session.close_warm']({ sessionId: 's1' }, ctx)
    expect(claudeCodeWarmQueryManager.closeAgentSessionWarm).toHaveBeenCalledWith('s1')
    expect(agentSessionRuntimeService.releaseIdleConnection).toHaveBeenCalledWith('s1')
  })

  it('respond_tool_approval delegates to AiService with the resolved sender WebContents', async () => {
    aiService.respondToolApproval.mockResolvedValue({ ok: true })
    const payload = { approvalId: 'a1', approved: true }

    const result = await aiHandlers['ai.tool.respond_approval'](payload, { senderId: 'w1' })

    expect(aiService.respondToolApproval).toHaveBeenCalledWith(payload, fakeWebContents)
    expect(result).toEqual({ ok: true })
  })

  it('respond_tool_approval passes undefined WebContents when the sender is not a managed window', async () => {
    aiService.respondToolApproval.mockResolvedValue({ ok: false })
    const payload = { approvalId: 'a1', approved: false }

    await aiHandlers['ai.tool.respond_approval'](payload, { senderId: null })

    expect(aiService.respondToolApproval).toHaveBeenCalledWith(payload, undefined)
    expect(windowManager.getWindow).not.toHaveBeenCalled()
  })
})

describe('aiHandlers — agent task commands', () => {
  const taskEntity = { id: 'task-1', agentId: 'agent-1', name: 'daily', enabled: true } as never
  const form = {
    name: 'daily',
    prompt: 'do it',
    trigger: { kind: 'interval', ms: 60_000 },
    workspace: { type: 'system' }
  } as never

  it('create delegates once to AgentJobsService and returns the committed entity', async () => {
    agentJobsService.createTask.mockReturnValue(taskEntity)

    const result = await aiHandlers['ai.agent.task.create']({ agentId: 'agent-1', ...(form as object) } as never, ctx)

    expect(agentJobsService.createTask).toHaveBeenCalledTimes(1)
    expect(agentJobsService.createTask).toHaveBeenCalledWith('agent-1', form)
    expect(result).toBe(taskEntity)
  })

  // The four-segment trigger-invalid chain: JobManager's coded Error must be
  // translated to the AI-domain IpcError, or IpcError.from would flatten it to
  // INTERNAL and the renderer form could not branch.
  it('create translates JOB_SCHEDULE_TRIGGER_INVALID into AI_AGENT_TASK_TRIGGER_INVALID', async () => {
    const domainError = Object.assign(new Error('JOB_SCHEDULE_TRIGGER_INVALID: Invalid trigger: bad expr'), {
      code: 'JOB_SCHEDULE_TRIGGER_INVALID'
    })
    agentJobsService.createTask.mockImplementation(() => {
      throw domainError
    })

    const error = await aiHandlers['ai.agent.task.create'](
      { agentId: 'agent-1', ...(form as object) } as never,
      ctx
    ).catch((e) => e)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_TRIGGER_INVALID)
  })

  it('update delegates and maps a null result to AI_AGENT_TASK_NOT_FOUND', async () => {
    agentJobsService.updateTask.mockReturnValueOnce(taskEntity)
    const patch = { name: 'renamed' }

    const result = await aiHandlers['ai.agent.task.update']({ agentId: 'agent-1', taskId: 'task-1', patch }, ctx)
    expect(agentJobsService.updateTask).toHaveBeenCalledWith('agent-1', 'task-1', patch)
    expect(result).toBe(taskEntity)

    agentJobsService.updateTask.mockReturnValueOnce(null)
    const error = await aiHandlers['ai.agent.task.update']({ agentId: 'agent-1', taskId: 'gone', patch }, ctx).catch(
      (e) => e
    )
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_NOT_FOUND)
  })

  it('update translates JOB_SCHEDULE_TRIGGER_INVALID into AI_AGENT_TASK_TRIGGER_INVALID', async () => {
    agentJobsService.updateTask.mockImplementation(() => {
      throw Object.assign(new Error('bad tz'), { code: 'JOB_SCHEDULE_TRIGGER_INVALID' })
    })

    const error = await aiHandlers['ai.agent.task.update'](
      { agentId: 'agent-1', taskId: 'task-1', patch: {} },
      ctx
    ).catch((e) => e)

    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_TRIGGER_INVALID)
  })

  it('pause / resume delegate and map null to AI_AGENT_TASK_NOT_FOUND', async () => {
    agentJobsService.pauseTask.mockResolvedValueOnce(taskEntity)
    expect(await aiHandlers['ai.agent.task.pause']({ agentId: 'agent-1', taskId: 'task-1' }, ctx)).toBe(taskEntity)
    expect(agentJobsService.pauseTask).toHaveBeenCalledWith('agent-1', 'task-1')

    agentJobsService.resumeTask.mockReturnValueOnce(null)
    const error = await aiHandlers['ai.agent.task.resume']({ agentId: 'agent-1', taskId: 'gone' }, ctx).catch((e) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_NOT_FOUND)
  })

  it('delete resolves void on success and maps false to AI_AGENT_TASK_NOT_FOUND', async () => {
    agentJobsService.deleteTask.mockResolvedValueOnce(true)
    expect(await aiHandlers['ai.agent.task.delete']({ agentId: 'agent-1', taskId: 'task-1' }, ctx)).toBeUndefined()
    expect(agentJobsService.deleteTask).toHaveBeenCalledWith('agent-1', 'task-1')

    agentJobsService.deleteTask.mockResolvedValueOnce(false)
    const error = await aiHandlers['ai.agent.task.delete']({ agentId: 'agent-1', taskId: 'gone' }, ctx).catch((e) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_NOT_FOUND)
  })

  it('run delegates with the owning agent id and maps false to AI_AGENT_TASK_NOT_FOUND', async () => {
    agentJobsService.runTask.mockResolvedValueOnce(true)
    await aiHandlers['ai.agent.task.run']({ agentId: 'agent-1', taskId: 'task-1' }, ctx)
    expect(agentJobsService.runTask).toHaveBeenCalledWith('agent-1', 'task-1')

    agentJobsService.runTask.mockResolvedValueOnce(false)
    const error = await aiHandlers['ai.agent.task.run']({ agentId: 'agent-1', taskId: 'gone' }, ctx).catch((e) => e)
    expect(error).toBeInstanceOf(IpcError)
    expect(error.code).toBe(aiErrorCodes.AI_AGENT_TASK_NOT_FOUND)
  })
})
