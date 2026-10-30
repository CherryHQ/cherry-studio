import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai'
import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { runtimeId, type InputState, type ObservationPayload } from '@cherrystudio/agent-runtime'
import type { PiDurableThreadHandle } from '@cherrystudio/agent-runtime-pi-durable'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { bindNativeInput, prepareNativeSubmission } from '@main/ai/agentSession/nativeSubmission'
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
import { gate, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import type { PiConnectionSnapshot } from '../pi/piConnectionSignature'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { prepareDurableBranch } from './durableContext'
import { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'

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
      captureAgentSessionUsage: () => ({ headers: {}, release: () => {} }),
      ensureInternalGateway: async () => ({ baseUrl: 'http://gateway.invalid', apiKey: 'fixture' }),
      getAgentSessionUsageHeaders: () => ({})
    },
    McpCatalogService: { listTools: () => [] },
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('../pi/piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('../pi/gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), getPathFromEnvironment: () => undefined }))

// Real Runtime, native Pi and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi Durable connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiDurableRuntimeConnection[] = []

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
        type: 'pi-durable',
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
    const connection = await new PiDurableRuntimeConnection(input).start()
    connections.push(connection)
    const nativeInputs: InputState[] = []
    const handle = (connection as unknown as { handle: PiDurableThreadHandle }).handle
    await handle.observe((event) => {
      if (event.type === 'snapshot') nativeInputs.push(...event.inputs)
      if (event.type === 'input.changed') nativeInputs.push(event.input)
    })
    const events: AgentRuntimeEvent[] = []
    const consuming = (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events, consuming, nativeInputs, handle }
  }
  async function done(events: AgentRuntimeEvent[]) {
    await expect.poll(() => events.some((event) => event.type === 'turn-complete' || event.type === 'error')).toBe(true)
  }
  function projected(events: AgentRuntimeEvent[]) {
    const messages = new Map<
      string,
      Extract<AgentRuntimeEvent, { type: 'message-projection' }>['projection']['messages'][number]
    >()
    for (const event of events) {
      if (event.type !== 'message-projection') continue
      for (const old of [...Object.keys(event.projection.replaces), ...event.projection.removed]) messages.delete(old)
      for (const message of event.projection.messages)
        if (event.projection.live.includes(message.id)) messages.set(message.id, message)
    }
    return [...messages.values()]
  }
  const text = (events: AgentRuntimeEvent[]) =>
    projected(events)
      .filter((message) => message.role === 'assistant')
      .flatMap((message) => message.parts.flatMap((part) => (part.type === 'text' ? [part.text] : [])))
      .join('')
  // An idle observation during summary generation must not finish the owning desktop turn.
  it.each(['complete', 'error', 'stop', 'close'] as const)(
    'keeps manual compaction owned through %s',
    async (outcome) => {
      const summary = gate()
      mocks.binding.mockImplementation(async () =>
        createTestBinding({ model: { ...MODEL, contextWindow: 1_000_000 }, stream: script.model })
      )
      script = respondingModel((call) =>
        call.systemPrompt.startsWith('Summarize the conversation')
          ? summary.wait(assistantReply('Remember the original objective', outcome === 'error' ? 'error' : 'stop'))
          : assistantReply('answer')
      )
      const { connection, events } = await connect()
      await connection.send({ message: message('Original objective') })
      await done(events)
      events.length = 0
      await connection.send({ message: message('Recent context '.repeat(8000)) })
      await done(events)
      events.length = 0
      const compacting = connection.send({ message: message('/compact') })
      try {
        await summary.reached
        expect(events.some((event) => event.type === 'compaction-start')).toBe(true)
        expect(events.filter((event) => event.type === 'turn-complete' || event.type === 'error')).toEqual([])
        await expect(connection.send({ message: message('overlapping input') })).rejects.toThrow('active submission')
        if (outcome === 'stop') await connection.interrupt()
        if (outcome === 'close') await connection.close()
      } finally {
        summary.open()
        await compacting
      }
      if (outcome === 'close') {
        expect(
          events.filter((event) => event.type === 'turn-complete' || event.type === 'compaction-complete')
        ).toEqual([])
        return
      }
      await done(events)
      if (outcome === 'error') {
        expect(events.filter((event) => event.type === 'compaction-complete')).toEqual([
          { type: 'compaction-complete' }
        ])
        expect(events.filter((event) => event.type === 'error')).toEqual([])
        return
      }
      if (outcome !== 'complete') {
        expect(
          events.filter((event) => event.type === 'compaction-complete' || event.type === 'turn-complete')
        ).toEqual([])
        expect(events.filter((event) => event.type === 'error')).toHaveLength(1)
        return
      }
      const terminals = events.filter((event) => event.type === 'compaction-complete' || event.type === 'turn-complete')
      expect(terminals.map((event) => event.type)).toEqual(['compaction-complete', 'turn-complete'])
      expect(events.filter((event) => event.type === 'error')).toEqual([])
    }
  )

  // A no-op command must explain its result instead of persisting an empty successful reply.
  it('shows an unchanged-history reply when manual compaction has no summary to commit', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('/compact') })
    await done(events)
    expect(text(events)).toBe('No summary was committed; the conversation is unchanged.')
    expect(events.filter((event) => event.type === 'compaction-complete')).toEqual([{ type: 'compaction-complete' }])
    expect(script.calls).toHaveLength(0)
  })

  // A freshly allocated Durable root must not resolve the verifier's initialization ID as a child.
  it('verifies and completes a goal in a newly created native root', async () => {
    script = respondingModel((call) => {
      if (call.systemPrompt.startsWith('Evaluate whether the objective'))
        return assistantReply('{"verdict":"met","reason":"Output is present"}')
      const results = call.messages.filter((entry) => entry.role === 'toolResult')
      const completed = results.find((entry) => entry.toolName === 'update_goal')
      if (completed) return assistantReply('GOAL_VERIFIED')
      const lookup = results.find((entry) => entry.toolName === 'get_goal')
      if (!lookup) return assistantReply([toolCallPart('get-goal', 'get_goal', {})], 'toolUse')
      const body = lookup.content.find((part) => part.type === 'text')!
      if (body.type !== 'text') throw new Error('Goal result has no text')
      const { goal } = JSON.parse(body.text.split('\n')[0])
      return assistantReply(
        [
          toolCallPart('complete-goal', 'update_goal', {
            goal_id: goal.id,
            revision: goal.revision,
            action: 'complete',
            evidence: 'The requested output has been produced.'
          })
        ],
        'toolUse'
      )
    })
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal Produce the requested output') })
    await expect.poll(() => text(events)).toContain('GOAL_VERIFIED')
    expect(script.calls.filter((call) => call.systemPrompt.startsWith('Evaluate whether the objective'))).toHaveLength(
      1
    )
    const completion = projected(events)
      .flatMap((message) => message.parts)
      .find((part) => part.type === 'dynamic-tool' && part.toolName === 'update_goal')
    expect(completion).toMatchObject({ state: 'output-available' })
  })

  // Locally handled commands must keep their answer when the desktop consumes message projections.
  it('shows the goal command answer without starting a model turn', async () => {
    const { connection, events } = await connect()
    await connection.send({ message: message('/goal') })
    await done(events)
    expect(text(events)).toBe('No goal is set. Use /goal <objective> to create one.')
    expect(script.calls).toHaveLength(0)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

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

  it('streams incrementally and reopens the same SQLite conversation without replaying old text', async () => {
    setScript([assistantReply('first streaming answer')])
    const finish = holdResponse('first streaming answer')
    const first = await connect()
    const user = message('first')
    await first.connection.send({ message: user })
    await expect.poll(() => text(first.events).length).toBeGreaterThan(0)
    expect(first.events.some((event) => event.type === 'turn-complete')).toBe(false)
    finish()
    await done(first.events)
    expect(text(first.events)).toBe('first streaming answer')
    expect(first.events.filter((event) => event.type === 'error')).toEqual([])
    const context = prepareDurableBranch(input.sessionId)
    expect(first.nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'completed')).toBe(true)
    expect(messages.inputBinding(input.sessionId, user.id)).toMatchObject({
      contextId: context.id,
      nativeInputId: expect.any(String)
    })
    await first.connection.close()
    setScript([assistantReply('second answer')])
    const second = await connect()
    await second.connection.send({ message: message('second') })
    await done(second.events)
    expect(text(second.events)).toBe('second answer')
    expect(prepareDurableBranch(input.sessionId).nativeThreadId).toBe(context.nativeThreadId)
    expect(JSON.stringify(script.calls[0].messages)).toContain('first streaming answer')
  })

  it('places a late steer as the next input before its model call and records both outcomes', async () => {
    setScript([assistantReply('next answer')])
    const finish = holdResponse('first answer')
    let injected = false
    input.onSteerInjected = () => {
      injected = true
    }
    const fallback = script.model
    script.model = (model, context, options) => {
      const steering = JSON.stringify(context.messages).includes('late correction')
      if (steering && !injected) throw new Error('Model request preceded steer placement')
      return fallback(model, context, options)
    }
    const { connection, events, nativeInputs } = await connect()
    const first = message('first')
    await connection.send({ message: first })
    await expect.poll(() => text(events)).toBe('first answer')
    finish()
    const late = message('late correction')
    expect(connection.redirect({ message: late })).toBe(true)
    await expect
      .poll(() => nativeInputs.some((state) => state.inputId === late.id && state.outcome === 'completed'))
      .toBe(true)
    expect(nativeInputs.some((state) => state.inputId === first.id && state.outcome === 'completed')).toBe(true)
    expect(injected).toBe(true)
    expect(text(events)).toBe('first answernext answer')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it.each(['reopen', 'retry archive flush'] as const)(
    'retains independent child output and continuation after %s',
    async (scenario) => {
      const held = gate()
      let root = ''
      let child = ''
      let childRuns = 0
      script = respondingModel((call) => {
        root ||= call.sessionId!
        if (call.sessionId !== root) {
          child = call.sessionId!
          childRuns++
          return childRuns === 1
            ? held.wait({ ...assistantReply('child first answer'), responseId: 'child-response-1' })
            : { ...assistantReply('child continued answer'), responseId: 'child-response-2' }
        }
        if (!call.messages.some((entry) => entry.role === 'toolResult'))
          return assistantReply(
            [
              toolCallPart('spawn', 'subagent', {
                description: 'research',
                prompt: 'child work',
                background: true,
                fork: false
              })
            ],
            'toolUse'
          )
        return assistantReply('parent done')
      })
      const { connection, events } = await connect()
      const user = message('delegate')
      await connection.send({ message: user })
      await held.reached
      await done(events)
      const view = await connection.childProjection('spawn')
      expect(view).toBeDefined()
      expect(view!.snapshot().canSubmit).toBe(true)
      expect(text(events)).not.toContain('child first')
      held.open()
      await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child first answer')
      await expect.poll(() => view!.snapshot().active).toBe(false)
      const contextId = view!.snapshot().contextId
      const childIdentity = contexts.context(contextId).nativeThreadId
      await connection.messageChild(contextId, 'continue research')
      await expect.poll(() => JSON.stringify(view!.snapshot().messages)).toContain('child continued answer')
      expect(contexts.context(contextId).nativeThreadId).toBe(childIdentity)
      const childMessage = view!
        .snapshot()
        .messages.find((message) =>
          message.parts.some((part) => part.type === 'text' && part.text === 'child continued answer')
        )!
      await expect
        .poll(() => events.filter((event) => event.type === 'response-start' && event.responseId === 'child-response-2'))
        .toContainEqual({
          type: 'response-start',
          responseId: 'child-response-2',
          messageId: childMessage.id,
          sessionId: contexts.context(view!.snapshot().contextId).sessionId
        })
      expect(child).not.toBe(root)
      expect(text(events)).not.toContain('child continued answer')
      expect(events.filter((event) => event.type === 'error')).toEqual([])
      if (scenario === 'retry archive flush') {
        const shutdown = vi.spyOn(connection['runtime']!, 'shutdown')
        vi.spyOn(contexts, 'saveProjectionTx').mockImplementationOnce(() => {
          throw new Error('archive temporarily unavailable')
        })
        await expect(connection.close()).rejects.toThrow('archive temporarily unavailable')
        await connection.close()
        expect(shutdown).toHaveBeenCalledTimes(1)
        expect(view!.snapshot().available).toBe(false)
      } else {
        await connection.close()
      }
      setScript([assistantReply('child answer after reopen')])
      const reopened = await connect()
      const restored = await reopened.connection.childProjection('spawn')
      expect(restored?.snapshot().contextId).toBe(contextId)
      expect(JSON.stringify(restored?.snapshot().messages)).toContain('child continued answer')
      expect(text(reopened.events)).toBe('')
      await reopened.connection.messageChild(contextId, 'continue after reopen')
      await expect.poll(() => JSON.stringify(restored!.snapshot().messages)).toContain('child answer after reopen')
      expect(script.calls[0].model.id).toBe(MODEL.id)
    }
  )

  it('streams child text and tool progress after the parent finishes', async () => {
    let root = ''
    const releaseTool = join(directory, 'release-tool')
    script = respondingModel((call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root)
        return assistantReply(
          [
            toolCallPart('child-bash', 'bash', {
              command: `printf 'TOOL-FIRST'; while [ ! -f '${releaseTool}' ]; do /bin/sleep 0.05; done; printf 'TOOL-LAST'`
            })
          ],
          'toolUse'
        )
      if (!call.messages.some((entry) => entry.role === 'toolResult'))
        return assistantReply(
          [toolCallPart('spawn', 'subagent', { description: 'streaming child', prompt: 'work', background: true })],
          'toolUse'
        )
      return assistantReply('parent done')
    })
    const fallback = script.model
    let append!: () => void
    let finish!: () => void
    script.model = (model, context, options) => {
      if (
        !root ||
        options?.sessionId === root ||
        !context.messages.some((entry) => entry.role === 'toolResult' && entry.toolCallId === 'child-bash')
      )
        return fallback(model, context, options)
      const stream = createAssistantMessageEventStream()
      const partial = { ...assistantReply('child prefix'), model: model.id, api: model.api, provider: model.provider }
      stream.push({ type: 'start', partial })
      stream.push({ type: 'text_delta', contentIndex: 0, delta: 'child prefix', partial })
      append = () => {
        partial.content = [{ type: 'text', text: 'child prefix suffix' }]
        stream.push({ type: 'text_delta', contentIndex: 0, delta: ' suffix', partial })
      }
      const abort = () => {
        partial.stopReason = 'aborted'
        stream.push({ type: 'error', reason: 'aborted', error: partial })
        stream.end(partial)
      }
      options?.signal?.addEventListener('abort', abort, { once: true })
      finish = () => {
        options?.signal?.removeEventListener('abort', abort)
        stream.push({ type: 'done', reason: 'stop', message: partial })
        stream.end(partial)
      }
      return stream
    }
    const { connection, events } = await connect()
    await connection.send({ message: message('delegate') })
    await done(events)
    const view = await connection.childProjection('spawn')
    expect(view).toBeDefined()
    const tool = () =>
      view!
        .snapshot()
        .messages.flatMap((message) => message.parts)
        .find((part) => part.type === 'dynamic-tool')
    await expect.poll(() => JSON.stringify(tool()?.output)).toContain('TOOL-FIRST')
    expect(view!.snapshot().active).toBe(true)
    expect(tool()).toMatchObject({
      toolCallId: 'child-bash',
      toolName: 'bash',
      state: 'output-available',
      preliminary: true,
      callProviderMetadata: { cherry: { transport: 'pi-agent' } }
    })
    expect(JSON.stringify(tool()?.output)).not.toContain('TOOL-LAST')

    writeFileSync(releaseTool, '')
    const answer = () =>
      view!
        .snapshot()
        .messages.find((message) =>
          message.parts.some((part) => part.type === 'text' && part.text.startsWith('child prefix'))
        )
    await expect.poll(answer).toMatchObject({
      metadata: { status: 'pending' },
      parts: expect.arrayContaining([{ type: 'text', text: 'child prefix', state: 'streaming' }])
    })
    const id = answer()!.id
    append()
    await expect.poll(answer).toMatchObject({
      id,
      metadata: { status: 'pending' },
      parts: expect.arrayContaining([{ type: 'text', text: 'child prefix suffix', state: 'streaming' }])
    })
    expect(view!.snapshot().active).toBe(true)
    expect(JSON.stringify(tool()?.output)).toContain('TOOL-LAST')
    expect(tool()).toMatchObject({ preliminary: false })
    finish()
    await expect.poll(() => view!.snapshot().active).toBe(false)
    expect(answer()).toMatchObject({ id, metadata: { status: 'success' } })
    expect(text(events)).not.toContain('child prefix')
    expect(events.filter((event) => event.type === 'error')).toEqual([])
  })

  it.each(['shutdown', 'stop'] as const)('distinguishes %s from durable cancellation', async (action) => {
    const held = gate()
    script = respondingModel(() => held.wait(assistantReply('unfinished')))
    const first = await connect()
    const user = message('work')
    await first.connection.send({ message: user })
    await held.reached
    if (action === 'stop') await first.connection.interrupt()
    await first.connection.close()
    setScript([assistantReply('recovered answer')])
    const reopened = await connect()
    if (action === 'shutdown') {
      await done(reopened.events)
      expect(text(reopened.events)).toBe('recovered answer')
    } else {
      await reopened.connection.close()
      expect(script.calls).toHaveLength(0)
      expect(first.nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'aborted')).toBe(true)
    }
  })

  it('persists cancellation during a native tool and does not continue after reopen', async () => {
    setScript([
      assistantReply(
        [
          toolCallPart('bash', 'bash', {
            command: 'echo ready > started.txt; /bin/sleep 30; echo late > completed.txt'
          })
        ],
        'toolUse'
      ),
      assistantReply('must not run')
    ])
    const { connection, events, nativeInputs } = await connect()
    const user = message('run a tool')
    await connection.send({ message: user })
    await expect.poll(() => existsSync(join(directory, 'started.txt'))).toBe(true)
    await connection.interrupt()
    await connection.close()
    expect(nativeInputs.some((state) => state.inputId === user.id && state.outcome === 'aborted')).toBe(true)
    expect(existsSync(join(directory, 'completed.txt'))).toBe(false)
    expect(text(events)).not.toContain('must not run')
    setScript([assistantReply('must not resume')])
    const reopened = await connect()
    await reopened.connection.close()
    expect(script.calls).toHaveLength(0)
  })

  it.each([true, false])('waits for native-only pending work with a retained message: %s', async (retained) => {
    const { connection, events, handle } = await connect()
    const context = prepareDurableBranch(input.sessionId)
    const nativeInput = { session: handle.thread, id: runtimeId<'native-input'>('queued-input') }
    if (retained) {
      const user = message('queued before restart')
      prepareNativeSubmission(input.sessionId, user.id, context.id, 'follow-up')
      bindNativeInput(input.sessionId, context.id, {
        inputId: runtimeId(user.id),
        nativeInput,
        facts: ['accepted', 'queued']
      })
    }
    const queued: InputState = { nativeInput, facts: ['accepted', 'queued'] }
    vi.spyOn(handle, 'lookupInput').mockResolvedValue({ status: 'confirmed', value: { found: true, input: queued } })
    const observer = connection as unknown as { onObservation(event: ObservationPayload): Promise<void> }
    const snapshot = { type: 'snapshot' as const, coverage: 'retained-view' as const, messages: [], inputs: [queued] }
    await observer.onObservation({ ...snapshot, activity: { scope: 'foreground', state: 'active' } })
    await observer.onObservation({ ...snapshot, activity: { scope: 'foreground', state: 'idle' } })
    expect(events.some((event) => event.type === 'autonomous-turn-state' && event.state === 'started')).toBe(true)
    expect(events.filter((event) => event.type === 'turn-complete' || event.type === 'error')).toEqual([])
    await observer.onObservation({ type: 'input.changed', input: { ...queued, outcome: 'completed' } })
    await done(events)
    expect(events.filter((event) => event.type === 'turn-complete')).toHaveLength(1)
    expect(events.filter((event) => event.type === 'error')).toEqual([])
    expect(script.calls).toHaveLength(0)
  })

  it.each(['rejected', 'unsupported', 'unknown'] as const)(
    'preserves only uncertain input bindings after %s',
    async (status) => {
      const { connection, handle } = await connect()
      const user = message('not accepted')
      vi.spyOn(handle.input, 'submit').mockResolvedValue({
        status,
        inputId: runtimeId(user.id),
        error: { operation: 'submit', code: 'fixture', message: status }
      })
      await expect(connection.send({ message: user })).rejects.toThrow(status)
      if (status === 'unknown') {
        expect(messages.inputBinding(input.sessionId, user.id)?.contextId).toBe(
          prepareDurableBranch(input.sessionId).id
        )
        expect(() => messages.deleteSessionMessage(input.sessionId, user.id)).toThrow('native input binding')
      } else {
        expect(messages.inputBinding(input.sessionId, user.id)).toBeUndefined()
        messages.updateSessionMessage(input.sessionId, user.id, {
          data: { parts: [{ type: 'text', text: 'corrected' }] }
        })
        messages.deleteSessionMessage(input.sessionId, user.id)
        expect(() => messages.getSessionMessage(input.sessionId, user.id)).toThrow()
      }
      expect(script.calls).toHaveLength(0)
    }
  )
})
