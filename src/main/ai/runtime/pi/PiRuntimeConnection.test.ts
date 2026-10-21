import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
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

import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import { createAiSdkModelBinding } from './aiSdkModelBinding'
import { finish, MODEL, scriptedModel, streamTextPort, tempDir, textParts } from './aiSdkSupport'
import * as PiApproval from './approvalExtension'
import type { PiConnectionSnapshot } from './piConnectionSignature'
import type * as PiMcpExtension from './piMcpExtension'
import { buildPiMcpToolName } from './piMcpExtension'
import { buildPiLoginPathPrefix, PiRuntimeConnection } from './PiRuntimeConnection'
import type * as PiSdk from './piSdk'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  binding: vi.fn(),
  prompt: vi.fn(),
  interaction: vi.fn<() => ToolGuardInteractionState>()
}))
vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    McpCatalogService: { listTools: () => [] },
    AgentSessionRuntimeService: { getInteractionState: mocks.interaction }
  }
  return mockApplicationFactory(overrides)
})
vi.mock('./piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))
vi.mock('./piModelPort', () => ({ createPiModelBinding: mocks.binding }))
vi.mock('@main/ai/runtime/agentPrompt', () => ({ buildAgentRuntimePrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: () => ({})
}))
vi.mock('./piMcpExtension', async (original) => ({
  ...(await original<typeof PiMcpExtension>()),
  createPiMcpExtension: () => () => {}
}))
vi.mock('./piSdk', async (original) => ({
  ...(await original<typeof PiSdk>()),
  loadPiVccExtension: async () => () => {}
}))
vi.mock('@main/utils/shellEnv', () => ({ getShellEnv: async () => ({}), getPathFromEnvironment: () => undefined }))

// Real Runtime, native Pi, AI SDK loop and SQLite; only provider/environment configuration is substituted.
describe('desktop Pi root connection', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  const connections: PiRuntimeConnection[] = []

  beforeEach(() => {
    mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    directory = tempDir('desktop-pi')
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = join(directory, key)
      if (key !== 'external.pi.settings_file' && key !== 'feature.agents.pi.sessions')
        mkdirSync(dir, { recursive: true })
      return file ? join(dir, file) : dir
    })
    const agentId = uuid()
    const workspaceId = uuid()
    input = { sessionId: uuid(), agentId, modelId: MODEL.id }
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
      agent: { ...agentService.getAgent(agentId)!, model: MODEL.id },
      session: agentSessionService.getById(input.sessionId),
      model: ModelSchema.parse({
        id: MODEL.id,
        providerId: 'cherry',
        name: 'Model',
        capabilities: [],
        supportsStreaming: true,
        isEnabled: true,
        isHidden: false
      }),
      provider: ProviderSchema.parse({
        id: 'cherry',
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
    setScript([[...textParts('answer', 'Hello ', 'world'), finish('stop')]])
    mocks.binding.mockImplementation(async () =>
      createAiSdkModelBinding({ model: MODEL, port: streamTextPort(script.model).port, requestOptions: undefined })
    )
  })
  afterEach(async () => {
    for (const connection of connections.splice(0)) await connection.close()
    vi.restoreAllMocks()
  })
  function setScript(parts: LanguageModelV3StreamPart[][], delay?: number) {
    script = scriptedModel(parts, delay)
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
      const extension = vi.spyOn(PiApproval, 'createPiApprovalExtension')
      const { connection } = await connect()
      const authorize = PiApproval.createPiToolAuthorizer(extension.mock.calls[0][0])

      for (const name of ['session_create', 'session_send']) {
        const request = { toolName: buildPiMcpToolName('cherry-tools', name), toolCallId: name, input: {} }
        await expect(authorize(request)).resolves.toBeUndefined()
        mocks.interaction.mockReturnValue({ currentTurn: 'headless', userResponse: 'unavailable' })
        await expect(authorize(request)).resolves.toMatchObject({ block: true })
        mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
      }
      expect(toolApprovalRegistry.size()).toBe(0)

      snapshot.agent.configuration = { ...snapshot.agent.configuration, permission_mode: 'default' }
      await expect(connection.reconcile({ modelId: input.modelId })).resolves.toBe('patched')
      const pending = authorize({
        toolName: buildPiMcpToolName('cherry-tools', 'session_send'),
        toolCallId: 'after-mode-change',
        input: {}
      })
      await vi.waitFor(() => expect(toolApprovalRegistry.size()).toBe(1))
      toolApprovalRegistry.abort(input.sessionId, 'test-cancel')
      await expect(pending).resolves.toMatchObject({ block: true })
    }
  )

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
    expect(JSON.stringify(script.calls[1].prompt)).toContain('first question')
    expect(JSON.stringify(script.calls[1].prompt)).toContain('Hello world')
    expect(nativeFiles()).toHaveLength(1)
  })

  it('executes a native tool once, projects its result, and sends it back through the model port', async () => {
    writeFileSync(join(directory, 'note.txt'), 'native tool result')
    setScript([
      [
        { type: 'tool-call', toolCallId: 'read-1', toolName: 'read', input: JSON.stringify({ path: 'note.txt' }) },
        finish('tool-calls')
      ],
      [...textParts('answer', 'Read successfully'), finish('stop')]
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
    expect(JSON.stringify(script.calls[1].prompt)).toContain('native tool result')
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
    setScript([[{ type: 'error', error: new Error('provider unavailable') }]])
    const { connection, events } = await connect()
    const user = message('question')
    await connection.send({ message: user })
    await done(events)
    expect(events.filter((event) => event.type === 'turn-complete')).toEqual([])
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('failed')
  })

  it('seals admission during stop, saves the aborted input, and reopens for a new message', async () => {
    script.model.doStream = async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'held' })
          controller.enqueue({ type: 'text-delta', id: 'held', delta: 'partial' })
        }
      })
    })
    const first = await connect()
    const user = message('question')
    await first.connection.send({ message: user })
    await expect.poll(() => text(first.events)).toBe('partial')
    const closing = first.connection.close()
    await expect(first.connection.send({ message: message('late') })).rejects.toThrow('unavailable')
    await closing
    expect(messages.readSubmission(input.sessionId, user.id).submission.outcome).toBe('aborted')
    expect(first.events.filter((event) => event.type === 'turn-complete')).toEqual([])
    setScript([[...textParts('next', 'resumed'), finish('stop')]])
    const next = await connect()
    await next.connection.send({ message: message('continue') })
    await done(next.events)
    expect(text(next.events)).toBe('resumed')
  })

  it('rebuilds for changed per-turn settings and rejects startup configuration drift', async () => {
    const { connection } = await connect()
    expect(await connection.reconcile({ modelId: MODEL.id, reasoningEffort: 'high' })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: MODEL.id, fastMode: true })).toBe('rebuild')
    expect(await connection.reconcile({ modelId: MODEL.id, serviceTier: 'flex' })).toBe('rebuild')
    await connection.close()
    mocks.prompt.mockImplementation(async () => {
      snapshot = { ...snapshot, signature: 'changed' }
      return { base: { kind: 'native' } }
    })
    await expect(connect()).rejects.toThrow('configuration changed')
  })
  it('orders the steer boundary and preserves the two native response associations', async () => {
    let release!: () => void
    const normalStream = script.model.doStream.bind(script.model)
    let calls = 0
    script.model.doStream = async (options) => {
      if (calls++ > 0) return normalStream(options)
      return {
        stream: new ReadableStream({
          start(controller) {
            controller.enqueue({ type: 'text-start', id: 'first' })
            controller.enqueue({ type: 'text-delta', id: 'first', delta: 'before steer' })
            release = () => {
              controller.enqueue({ type: 'text-end', id: 'first' })
              controller.enqueue(finish('stop'))
              controller.close()
            }
          }
        })
      }
    }
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
    script.model.doStream = async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({ type: 'text-start', id: 'held' })
          controller.enqueue({ type: 'text-delta', id: 'held', delta: 'waiting' })
        }
      })
    })
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
      ...(await createAiSdkModelBinding({
        model: MODEL,
        port: streamTextPort(script.model).port,
        requestOptions: undefined
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
    expect(JSON.stringify(script.calls[0].prompt)).toContain('/tmp/note.txt')
    expect(messages.getSessionMessage(input.sessionId, user.id)).not.toHaveProperty('submission')
  })

  it('blocks disabled native tools before they can modify the workspace', async () => {
    snapshot.agent.disabledTools = ['write']
    setScript([
      [
        {
          type: 'tool-call',
          toolCallId: 'blocked',
          toolName: 'write',
          input: JSON.stringify({ path: 'forbidden.txt', content: 'bad' })
        },
        finish('tool-calls')
      ],
      [...textParts('answer', 'Tool unavailable'), finish('stop')]
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
