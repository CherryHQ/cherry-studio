import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { AssistantMessage } from '@earendil-works/pi-ai'
import { createAssistantMessageEventStream, Type } from '@earendil-works/pi-ai'
import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { toolApprovalRegistry } from '@main/ai/toolApproval/ToolApprovalRegistry'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'

import {
  assistantReply,
  createTestBinding,
  MODEL,
  scriptedModel,
  respondingModel,
  tempDir
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { gate, subagentCall, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import type { PiConnectionSnapshot } from './piConnectionSignature'
import type * as PiMcpExtension from './piMcpExtension'
import { buildPiMcpToolName } from './piMcpExtension'
import { buildPiLoginPathPrefix, PiRuntimeConnection } from './PiRuntimeConnection'

const modelId = 'test::test-model'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  binding: vi.fn(),
  prompt: vi.fn(),
  interaction: vi.fn<() => ToolGuardInteractionState>(),
  delegated: vi.fn()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    ApiGatewayService: {
      ensureInternalGateway: async () => ({ baseUrl: 'http://gateway.invalid', apiKey: 'fixture' }),
      getAgentSessionUsageHeaders: () => ({})
    },
    McpCatalogService: { listTools: () => [] },
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('./piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('./gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('./piMcpExtension', async (original) => ({
  ...(await original<typeof PiMcpExtension>()),
  createPiMcpExtension: () => (pi: { registerTool: (tool: unknown) => void }) => {
    for (const name of ['session_create', 'session_send'])
      pi.registerTool({
        name: buildPiMcpToolName('cherry-tools', name),
        label: name,
        description: name,
        parameters: Type.Object({}),
        execute: async () => {
          mocks.delegated()
          return { content: [{ type: 'text', text: 'delegated' }] }
        }
      })
  }
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), getPathFromEnvironment: () => undefined }))

// Real Runtime, native Pi and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi root connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiRuntimeConnection[] = []

  beforeEach(() => {
    mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    mocks.delegated.mockClear()
    directory = tempDir('desktop-pi')
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = join(directory, key)
      if (key !== 'external.pi.settings_file' && key !== 'feature.agents.pi.sessions')
        mkdirSync(dir, { recursive: true })
      return file ? join(dir, file) : dir
    })
    const agentId = uuid()
    const workspaceId = uuid()
    input = { sessionId: uuid(), agentId, modelId: modelId }
    dbh.db
      .insert(agentTable)
      .values({
        id: agentId,
        name: 'Pi',
        type: 'pi',
        instructions: '',
        configuration: { permission_mode: 'bypassPermissions' },
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: workspaceId, name: 'Work', path: directory, type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values({ id: input.sessionId, agentId, workspaceId, name: 'Chat', orderKey: 'a0' })
      .run()
    snapshot = {
      agent: { ...agentService.getAgent(agentId)!, model: modelId },
      session: agentSessionService.getById(input.sessionId),
      model: ModelSchema.parse({
        id: modelId,
        providerId: 'test',
        name: 'Model',
        capabilities: ['function-call'],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }),
      provider: ProviderSchema.parse({
        id: 'test',
        name: 'Provider',
        settings: {},
        reportsActualCost: false,
        apiKeys: [],
        authType: 'api-key',
        isEnabled: true
      }),
      enabledApiKeys: [],
      additionalSkillPaths: [],
      mcpServerSnapshots: new Map(),
      linkedChannel: null,
      effectiveLanguage: null,
      signature: 'frozen'
    }
    mocks.capture.mockImplementation(async () => snapshot)
    mocks.prompt.mockResolvedValue({ base: { kind: 'custom', content: 'You are Cherry.' } })
    setScript([assistantReply('Hello world')])
    mocks.binding.mockImplementation(async () => createTestBinding({ model: MODEL, stream: script.model }))
  })
  afterEach(async () => {
    for (const connection of connections.splice(0)) await connection.close()
    vi.restoreAllMocks()
  })
  function setScript(parts: AssistantMessage[], delay?: number) {
    script = scriptedModel(parts, delay)
  }
  function holdResponse(text: string) {
    const fallback = script.model
    let finish!: () => void
    let started = false
    script.model = (model, context, options) => {
      if (started) return fallback(model, context, options)
      started = true
      const stream = createAssistantMessageEventStream()
      const message = { ...assistantReply(text), model: model.id, api: model.api, provider: model.provider }
      stream.push({ type: 'start', partial: message })
      stream.push({ type: 'text_delta', contentIndex: 0, delta: text, partial: message })
      const abort = () => {
        message.stopReason = 'aborted'
        stream.push({ type: 'error', reason: 'aborted', error: message })
        stream.end(message)
      }
      options?.signal?.addEventListener('abort', abort, { once: true })
      finish = () => {
        options?.signal?.removeEventListener('abort', abort)
        stream.push({ type: 'done', reason: 'stop', message })
        stream.end(message)
      }
      return stream
    }
    return () => finish()
  }
  function message(text: string) {
    return messages.saveMessage({
      sessionId: input.sessionId,
      message: { id: uuid(), role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
  }
  async function connect() {
    const connection = await new PiRuntimeConnection(input).start()
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    const consuming = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events, consuming }
  }
  async function done(events: AgentRuntimeEvent[]) {
    await expect.poll(() => events.some((event) => event.type === 'turn-complete' || event.type === 'error')).toBe(true)
  }
  const text = (events: AgentRuntimeEvent[]) =>
    events
      .flatMap((event) => (event.type === 'chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []))
      .join('')
  function nativeFiles() {
    const directory = application.getPath('feature.agents.pi.sessions')
    return existsSync(directory) ? readdirSync(directory) : []
  }

  it.each(['auto', 'bypassPermissions'] as const)(
    'preserves live delegation approval in %s mode after connecting through the Runtime',
    async (permission_mode) => {
      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode }
      const tool = buildPiMcpToolName('cherry-tools', 'session_send')
      setScript([
        assistantReply([{ type: 'toolCall', id: 'interactive', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('first done'),
        assistantReply([{ type: 'toolCall', id: 'headless', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('second done'),
        assistantReply([{ type: 'toolCall', id: 'ask', name: tool, arguments: {} }], 'toolUse'),
        assistantReply('third done')
      ])
      const { connection, events } = await connect()
      await connection.send({ message: message('interactive') })
      await done(events)
      expect(mocks.delegated.mock.calls.length).toBe(1)
      events.length = 0
      mocks.interaction.mockReturnValue({ currentTurn: 'headless', userResponse: 'unavailable' })
      await connection.send({ message: message('headless') })
      await done(events)
      const refused = script.calls.at(-1)!.messages.findLast((entry) => entry.role === 'toolResult')
      expect(JSON.stringify(refused)).toContain('Cross-Session delegation requires an interactive user turn')
      expect(mocks.delegated.mock.calls.length).toBe(1)
      expect(toolApprovalRegistry.size()).toBe(0)
      events.length = 0
      mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
      expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
      await connection.send({ message: message('ask') })
      await expect.poll(() => events.find((event) => event.type === 'tool-approval-request')).toBeDefined()
      const request = events.find((event) => event.type === 'tool-approval-request')!
      if (request.type !== 'tool-approval-request') throw new Error('No approval')
      expect(request.request.toolCallId).toBe('ask')
      toolApprovalRegistry.dispatch(request.request.approvalId, {
        approved: false,
        reasonSource: 'user',
        reason: 'declined'
      })
      await done(events)
      expect(mocks.delegated.mock.calls.length).toBe(1)
      expect(script.calls.at(-1)!.messages.findLast((entry) => entry.role === 'toolResult')).toMatchObject({
        content: [expect.objectContaining({ text: expect.stringContaining('the user said:\ndeclined') })]
      })
    }
  )

  // Catches approval edits being shown in the UI but the original write still executing.
  it('executes only approved arguments and returns a question answer to the native loop', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
    setScript([
      assistantReply([toolCallPart('write', 'write', { path: 'original.txt', content: 'original' })], 'toolUse'),
      assistantReply(
        [
          toolCallPart('ask', 'AskUserQuestion', {
            questions: [
              {
                question: 'Which database?',
                header: 'Database',
                options: [
                  { label: 'Postgres', description: 'Relational' },
                  { label: 'Redis', description: 'In memory' }
                ]
              }
            ]
          })
        ],
        'toolUse'
      ),
      assistantReply('Use Redis')
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('write and ask') })
    const approvals = () => events.filter((event) => event.type === 'tool-approval-request')
    await expect.poll(() => approvals().length).toBe(1)
    expect(existsSync(join(directory, 'original.txt'))).toBe(false)
    expect(approvals()[0].request.toolCallId).toBe('write')
    toolApprovalRegistry.dispatch(approvals()[0].request.approvalId, {
      approved: true,
      updatedInput: { path: 'approved.txt', content: 'approved' }
    })
    await expect.poll(() => approvals().length).toBe(2)
    expect(approvals()[1].request).toMatchObject({ toolCallId: 'ask', toolName: 'AskUserQuestion' })
    toolApprovalRegistry.dispatch(approvals()[1].request.approvalId, {
      approved: true,
      updatedInput: { answers: { 'Which database?': 'Redis' } }
    })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(readFileSync(join(directory, 'approved.txt'), 'utf8')).toBe('approved')
    expect(existsSync(join(directory, 'original.txt'))).toBe(false)
    expect(JSON.stringify(script.calls.at(-1)!.messages)).toContain('Redis')
    expect(toolApprovalRegistry.size()).toBe(0)
  })

  // Catches shutdown waiting indefinitely for an unanswered desktop question.
  it('withdraws a pending question on close without another model request', async () => {
    setScript([
      assistantReply(
        [
          toolCallPart('ask', 'AskUserQuestion', {
            questions: [
              {
                question: 'Continue?',
                header: 'Next',
                options: [
                  { label: 'Yes', description: 'Continue' },
                  { label: 'No', description: 'Stop' }
                ]
              }
            ]
          })
        ],
        'toolUse'
      )
    ])
    const { connection, events, consuming } = await connect()
    await connection.send({ message: message('ask') })
    await expect.poll(() => events.some((event) => event.type === 'tool-approval-request')).toBe(true)
    await connection.close()
    await consuming
    expect(toolApprovalRegistry.size()).toBe(0)
    expect(script.calls).toHaveLength(1)
  })

  // Catches a child stream being dropped or attributed to the root's text, and a continuation creating a new child.
  it('streams a foreground child and continues the same child in the desktop connection', async () => {
    let root = ''
    let child = ''
    let childRuns = 0
    script = respondingModel((call) => {
      if (call.sessionId !== root) {
        child = call.sessionId!
        childRuns++
        return assistantReply(childRuns === 1 ? 'child first answer' : 'child continued answer')
      }
      const last = JSON.stringify(call.messages.at(-1))
      if (last.includes('delegate now'))
        return assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan files' })], 'toolUse')
      if (last.includes('continue child'))
        return assistantReply(
          [toolCallPart('continue', 'message_subagent', { id: child, message: 'continue work' })],
          'toolUse'
        )
      return assistantReply('parent finished')
    }, 1)
    const { connection, events } = await connect()
    await connection.send({ message: message('initialize') })
    await done(events)
    root = script.calls[0].sessionId!
    childRuns = 0
    events.length = 0
    await connection.send({ message: message('delegate now') })
    await done(events)
    const firstChild = child
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    const childText = () =>
      events
        .flatMap((event) =>
          event.type === 'background-flow-chunk' && event.chunk.type === 'text-delta' ? [event.chunk.delta] : []
        )
        .join('')
    expect(childText()).toBe('child first answer')
    expect(text(events)).toBe('parent finished')
    expect(events.filter((event) => event.type === 'background-task-event').at(-1)).toMatchObject({
      data: { taskId: child, toolUseId: 'spawn', title: 'scan', status: 'completed', isBackgrounded: false }
    })
    expect(events).toContainEqual(
      expect.objectContaining({
        type: 'background-flow-chunk',
        rootToolCallId: 'spawn',
        chunk: expect.objectContaining({
          type: 'text-start',
          providerMetadata: { cherry: { parentToolCallId: 'spawn' } }
        })
      })
    )
    events.length = 0
    await connection.send({ message: message('continue child') })
    await done(events)
    await expect.poll(() => childText()).toContain('child continued answer')
    expect(child).toBe(firstChild)
    expect(nativeFiles()).toHaveLength(2)
    await expect
      .poll(() =>
        script.calls
          .filter((call) => call.sessionId === root)
          .some((call) => JSON.stringify(call.messages).includes('child continued answer'))
      )
      .toBe(true)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  // Catches a background stop missing the child and a late stop cancelling its parent's later turn.
  it('stops a running background child without cancelling a later parent turn', async () => {
    const held = gate()
    let root = ''
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) return held.wait(assistantReply('must not finish'))
      return JSON.stringify(call.messages.at(-1)).includes('delegate now')
        ? assistantReply([subagentCall('spawn', { description: 'scan', prompt: 'scan', background: true })], 'toolUse')
        : assistantReply('parent finished')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate now') })
    await held.reached
    await done(events)
    const tasks = events.find((event) => event.type === 'background-tasks' && event.tasks.length > 0)
    if (tasks?.type !== 'background-tasks') throw new Error('No child task')
    expect(events.filter((event) => event.type === 'background-task-event').at(-1)).toMatchObject({
      data: { taskId: tasks.tasks[0].id, toolUseId: 'spawn', status: 'in_progress', isBackgrounded: true }
    })
    expect(await connection.stopTask(tasks.tasks[0].id)).toBe(true)
    held.open()
    await expect
      .poll(() => events.filter((event) => event.type === 'background-work-state').at(-1))
      .toMatchObject({ active: false })
    expect(events.filter((event) => event.type === 'background-task-event').at(-1)).toMatchObject({
      data: { taskId: tasks.tasks[0].id, toolUseId: 'spawn', status: 'stopped', isBackgrounded: true }
    })
    events.length = 0
    await connection.send({ message: message('later parent turn') })
    await done(events)
    expect(text(events)).toBe('parent finished')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  // Catches the desktop never opening a receive-only stream when a paused goal resumes.
  it('starts and finishes an autonomous goal turn when plan permission is lifted', async () => {
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'plan' }
    script = respondingModel((call) => {
      if (call.systemPrompt?.includes('Evaluate whether the objective'))
        return assistantReply('{"verdict":"met","reason":"checked"}')
      const last = call.messages.at(-1)
      if (last?.role === 'toolResult' && last.toolName === 'get_goal') {
        const content = last.content.find((part) => part.type === 'text')
        if (content?.type !== 'text') throw new Error('No goal view')
        const { goal } = JSON.parse(content.text)
        return assistantReply(
          [
            toolCallPart('complete', 'update_goal', {
              goal_id: goal.id,
              revision: goal.revision,
              action: 'complete',
              evidence: 'checked files'
            })
          ],
          'toolUse'
        )
      }
      if (last?.role === 'toolResult') return assistantReply('completed')
      return assistantReply([toolCallPart('get', 'get_goal')], 'toolUse')
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal check the files') })
    await done(events)
    expect(script.calls).toHaveLength(0)
    events.length = 0
    snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'auto' }
    expect(await connection.reconcile({ modelId: input.modelId })).toBe('patched')
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    const started = events.findIndex((event) => event.type === 'autonomous-turn-state' && event.state === 'started')
    const firstChunk = events.findIndex((event) => event.type === 'chunk')
    expect(started).toBeGreaterThanOrEqual(0)
    expect(started).toBeLessThan(firstChunk)
    expect(events.at(-1)).toMatchObject({ type: 'autonomous-turn-state', state: 'finished' })
    expect(script.calls).toHaveLength(4)
    expect(events[started]).toMatchObject({ origin: { kind: 'goal-round', round: 1 } })
  })

  it('streams through the Runtime, records placed and completed separately, and saves a native checkpoint', async () => {
    const { connection, events } = await connect()
    expect(nativeFiles()).toEqual([])
    const user = message('question')
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(text(events)).toBe('Hello world')
    expect(messages.readSubmission(input.sessionId, user.id).submission).toMatchObject({
      facts: expect.arrayContaining(['dispatch-started', 'placed']),
      outcome: 'completed',
      nativeInputId: expect.any(String)
    })
    const completion = events.find((event) => event.type === 'turn-complete')
    expect(completion).toMatchObject({ forkAnchor: { checkpoint: { runtime: 'pi', leafId: expect.any(String) } } })
    expect(events.filter((event) => event.type === 'input-response')).toHaveLength(1)
    expect(nativeFiles()).toHaveLength(1)
  })

  it('reopens the native history without replaying archived content into the live product stream', async () => {
    const first = await connect()
    await first.connection.send({ message: message('first question') })
    await done(first.events)
    await first.connection.close()
    const reopened = await connect()
    await reopened.connection.send({ message: message('second question') })
    await done(reopened.events)
    expect(text(reopened.events)).toBe('Hello world')
    expect(JSON.stringify(script.calls[1].messages)).toContain('first question')
    expect(JSON.stringify(script.calls[1].messages)).toContain('Hello world')
    expect(nativeFiles()).toHaveLength(1)
  })

  it('executes a native tool once, projects its result, and sends it back through the model port', async () => {
    writeFileSync(join(directory, 'note.txt'), 'native tool result')
    setScript([
      assistantReply([{ type: 'toolCall', id: 'read-1', name: 'read', arguments: { path: 'note.txt' } }], 'toolUse'),
      assistantReply([{ type: 'text', text: 'Read successfully' }])
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('read the note') })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(text(events)).toBe('Read successfully')
    const results = events.filter((event) => event.type === 'chunk' && event.chunk.type === 'tool-output-available')
    expect(results).toHaveLength(1)
    expect(JSON.stringify(results)).toContain('native tool result')
    expect(script.calls).toHaveLength(2)
    expect(JSON.stringify(script.calls[1].messages)).toContain('native tool result')
  })

  it('rejects missing or ambiguous history without creating a replacement', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('save history') })
    await done(events)
    await connection.close()
    const file = nativeFiles()[0]
    copyFileSync(
      application.getPath('feature.agents.pi.sessions', file),
      application.getPath('feature.agents.pi.sessions', `copy_${file}`)
    )
    await expect(connect()).rejects.toThrow('ambiguous')
    for (const file of nativeFiles()) rmSync(application.getPath('feature.agents.pi.sessions', file))
    await expect(connect()).rejects.toThrow('missing')
    expect(nativeFiles()).toEqual([])
  })

  it('never initializes a missing file for a prepared but unresolved submission', async () => {
    const user = message('uncertain dispatch')
    const context = contexts.preparePiBranch(input.sessionId)
    messages.prepareSubmission(input.sessionId, user.id, context.id, 'reject')
    await expect(connect()).rejects.toThrow('missing')
    expect(nativeFiles()).toEqual([])
  })

  it('keeps a primed owner idle and permits reopen before any input has created a native file', async () => {
    const first = await connect()
    expect(first.connection.retainWhileIdle).toBe(true)
    await first.connection.close()
    const next = await connect()
    expect(nativeFiles()).toEqual([])
    expect(next.events.filter((event) => event.type === 'resume-token')).toEqual([])
  })

  it('preserves an original provider error and never announces a successful turn', async () => {
    setScript([{ ...assistantReply([], 'error'), errorMessage: 'provider unavailable' }])
    const { connection, events } = await connect()
    const user = message('question')
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([])
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('failed')
  })

  it('seals admission during stop, saves the aborted input, and reopens for a new message', async () => {
    holdResponse('partial')
    const first = await connect()
    const user = message('question')
    await first.connection.send({ message: user })
    await expect.poll(() => text(first.events)).toBe('partial')
    const closing = first.connection.close()
    await expect(first.connection.send({ message: message('late') })).rejects.toThrow('unavailable')
    await closing
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('aborted')
    expect(first.events.filter((event) => event.type === 'turn-complete')).toEqual([])
    setScript([assistantReply([{ type: 'text', text: 'resumed' }])])
    const next = await connect()
    await next.connection.send({ message: message('continue') })
    await done(next.events)
    expect(text(next.events)).toBe('resumed')
  })

  it('rebuilds for changed per-turn settings and rejects startup configuration drift', async () => {
    const { connection } = await connect()
    expect(await connection.reconcile({ modelId: modelId, reasoningEffort: 'high' })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: modelId, fastMode: true })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: modelId, serviceTier: 'flex' })).toBe('rebuild')
    await connection.close()
    mocks.prompt.mockImplementation(async () => {
      snapshot = { ...snapshot, signature: 'changed' }
      return { base: { kind: 'native' } }
    })
    await expect(connect()).rejects.toThrow('configuration changed')
  })
  it('orders the steer boundary and preserves the two native response associations', async () => {
    const release = holdResponse('before steer')
    let reserved = false
    input.onSteerInjected = () => {
      reserved = true
    }
    const { connection, events } = await connect()
    const first = message('first input')
    await connection.send({ message: first })
    await expect.poll(() => text(events)).toBe('before steer')
    const followup = message('follow up')
    expect(connection.redirect({ message: followup })).toBe(true)
    await expect.poll(() => messages.readSubmission(input.sessionId, followup.id).submission.facts).toContain('queued')
    release()
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(reserved).toBe(true)
    const boundary = events.findIndex((event) => event.type === 'steer-boundary')
    expect(text(events.slice(0, boundary))).toBe('before steer')
    expect(text(events.slice(boundary))).toBe('Hello world')
    const responses = events.flatMap((event) => (event.type === 'input-response' ? [event.input] : []))
    expect(responses.map((response) => response.inputId).sort()).toEqual([first.id, followup.id].sort())
    expect(new Set(responses.map((response) => response.response?.id)).size).toBe(2)
    expect(
      events.slice(0, boundary).some((event) => event.type === 'input-response' && event.input.inputId === first.id)
    ).toBe(true)
    expect(
      events.slice(boundary).some((event) => event.type === 'input-response' && event.input.inputId === followup.id)
    ).toBe(true)
  })

  it('cancels queued input on stop without automatically sending it in the next owner', async () => {
    holdResponse('waiting')
    const { connection, events } = await connect()
    await connection.send({ message: message('first') })
    await expect.poll(() => text(events)).toBe('waiting')
    const followup = message('never placed')
    expect(connection.redirect({ message: followup })).toBe(true)
    await expect.poll(() => messages.readSubmission(input.sessionId, followup.id).submission.facts).toContain('queued')
    await connection.close()
    expect(messages.readSubmission(input.sessionId, followup.id).submission).toMatchObject({ outcome: 'aborted' })
    const saved = nativeFiles()
      .map((file) => readFileSync(application.getPath('feature.agents.pi.sessions', file), 'utf8'))
      .join('')
    expect(saved).not.toContain('never placed')
  })

  it('compacts through the Pi facet without replaying history or creating a second user input', async () => {
    mocks.binding.mockImplementation(async () => ({
      ...(await createTestBinding({
        model: MODEL,
        stream: script.model
      })),
      compaction: { reserveTokens: 16_384, keepRecentTokens: 1 }
    }))
    const { connection, events } = await connect()
    await connection.send({ message: message('history to summarize') })
    await done(events)
    await connection.send({ message: message('another fact') })
    await expect.poll(() => events.filter((event) => event.type === 'turn-complete')).toHaveLength(2)
    const before = events.length
    const compact = message('/compact keep the important facts')
    await connection.send({ message: compact })
    await expect.poll(() => events.slice(before).some((event) => event.type === 'turn-complete')).toBe(true)
    expect(events.slice(before).filter((event) => event.type === 'error')).toEqual([])
    expect(text(events.slice(before))).toBe('')
    expect(messages.hasSubmission(input.sessionId, compact.id)).toBe(false)
    expect(events.slice(before).some((event) => event.type === 'compaction-complete')).toBe(true)
    expect(script.calls.at(-1)!.systemPrompt).toContain('Summarize the conversation')
    expect(script.calls.at(-1)!.tools).toEqual([])
  })

  it('forwards attachment paths through the input boundary while retaining private input facts', async () => {
    const user = messages.saveMessage({
      sessionId: input.sessionId,
      message: {
        id: uuid(),
        role: 'user',
        data: {
          parts: [
            { type: 'text', text: 'read the attachment' },
            { type: 'file', filename: 'note.txt', mediaType: 'text/plain', url: 'file:///tmp/note.txt' }
          ]
        }
      }
    })
    const { connection, events } = await connect()
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(JSON.stringify(script.calls[0].messages)).toContain('/tmp/note.txt')
    expect(messages.getSessionMessage(input.sessionId, user.id)).not.toHaveProperty('submission')
  })

  it('blocks disabled native tools before they can modify the workspace', async () => {
    snapshot.agent.disabledTools = ['write']
    setScript([
      assistantReply(
        [{ type: 'toolCall', id: 'blocked', name: 'write', arguments: { path: 'forbidden.txt', content: 'bad' } }],
        'toolUse'
      ),
      assistantReply([{ type: 'text', text: 'Tool unavailable' }])
    ])
    const { connection, events } = await connect()
    await connection.send({ message: message('write something') })
    await done(events)
    expect(existsSync(join(directory, 'forbidden.txt'))).toBe(false)
    expect(script.calls[0].tools?.some((tool) => tool.name === 'write')).toBe(false)
    expect(text(events)).toBe('Tool unavailable')
  })

  it('does not create a missing user workspace and prepares an absent system workspace before prompt loading', async () => {
    const missing = join(directory, 'missing')
    snapshot.session.workspace.path = missing
    await expect(connect()).rejects.toThrow()
    expect(existsSync(missing)).toBe(false)
    snapshot.session.workspace.type = 'system'
    snapshot.session.workspace.path = join(
      application.getPath('feature.agents.system_workspaces'),
      '2026-10-21',
      input.sessionId
    )
    mocks.prompt.mockImplementation(async ({ workspacePath }) => {
      expect(existsSync(workspacePath)).toBe(true)
      return { base: { kind: 'custom', content: 'You are Cherry.' } }
    })
    const { connection } = await connect()
    await connection.close()
    expect(existsSync(snapshot.session.workspace.path)).toBe(true)
  })

  it('quotes login paths without replacing Pi PATH prefixes', () => {
    expect(buildPiLoginPathPrefix("/opt/homebrew/bin:/Users/o'connor/bin", 'darwin')).toBe(
      "export PATH=\"$PATH\":'/opt/homebrew/bin:/Users/o'\"'\"'connor/bin'"
    )
    expect(buildPiLoginPathPrefix('C:\\tools', 'win32')).toBeUndefined()
  })
})
