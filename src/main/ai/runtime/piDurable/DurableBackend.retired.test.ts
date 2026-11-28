import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { realpath } from 'node:fs/promises'
import { join } from 'node:path'

import { BACKGROUND_CONTEXT } from '@earendil-works/chord/context'
import { copyJson, type JsonRepresentation } from '@earendil-works/chord/json'
import {
  AgentDoc,
  defineExtension,
  defineTask,
  ToolTask,
  type ConversationId,
  type Harness,
  type TaskId
} from '@earendil-works/pi-durable'
import { SqliteStorage } from '@earendil-works/pi-durable/storage/sqlite'
import { McpServer } from '@modelcontextprotocol/server'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { v7 as uuid } from 'uuid'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { application } from '@application'
import { encodeEntry } from '@cherrystudio/agent-behavior'
import { runtimeId } from '@cherrystudio/agent-runtime'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionContextService as contexts } from '@data/services/AgentSessionContextService'
import { agentSessionMessageService as messages } from '@data/services/AgentSessionMessageService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { AgentSessionForkOperations } from '@main/ai/agentSession/fork/AgentSessionForkOperations'
import { checkCommand } from '@main/ai/toolApproval/commandPolicy'
import type { ToolGuardInteractionState } from '@main/ai/toolApproval/toolGuards'
import { getShellEnv } from '@main/utils/shellEnv'
import { ModelSchema } from '@shared/data/types/model'
import { ProviderSchema } from '@shared/data/types/provider'

import {
  assistantReply,
  createTestBinding,
  MODEL,
  respondingModel,
  scriptedModel,
  tempDir
} from '../../../../../packages/agent-runtime-pi/tests/sessionSupport'
import { subagentCall, toolCallPart } from '../../../../../packages/agent-runtime-pi/tests/subagentSupport'
import type * as AgentMcpServers from '../agentMcpServers'
import type { PiConnectionSnapshot } from '../pi/piConnectionSignature'
import { runtimeDriverRegistry } from '../registry'
import type { AgentRuntimeConnectInput, AgentRuntimeEvent } from '../types'
import type { DurableBackend } from './DurableBackend'
import { prepareDurableBranch } from './durableContext'
import * as durableDesktopModule from './durableDesktop'
import type { PiDurableRuntimeConnection } from './PiDurableRuntimeConnection'
import { PiDurableRuntimeDriver } from './PiDurableRuntimeDriver'

const modelId = 'test::test-model'

const mocks = vi.hoisted(() => ({
  capture: vi.fn(),
  binding: vi.fn(),
  prompt: vi.fn(),
  mcpServers: vi.fn(),
  catalog: vi.fn(),
  interaction: vi.fn<() => ToolGuardInteractionState>(),
  adopt: vi.fn()
}))

vi.mock('@application', async () => {
  const { mockApplicationFactory, defaultServiceInstances } = await import('@test-mocks/main/application')
  const overrides = {
    DbService: defaultServiceInstances.DbService,
    ApiGatewayService: {
      captureAgentSessionUsage: () => ({ headers: {}, release: () => {} }),
      ensureInternalGateway: async () => {
        throw new Error('Pi Durable must start without an internal HTTP listener')
      },
      getAgentSessionUsageHeaders: () => ({})
    },
    McpCatalogService: { listTools: mocks.catalog, onToolsCacheUpdated: () => ({ dispose() {} }) },
    McpRuntimeService: {
      getConnectedServerInstructions: () => undefined,
      onCatalogChanged: () => ({ dispose() {} }),
      onResourceUpdated: () => ({ dispose() {} })
    },
    AgentSessionRuntimeService: {
      getInteractionState: mocks.interaction,
      adoptDurableConnection: mocks.adopt,
      getTurnTrustedNotifyChannels: () => undefined
    }
  }
  return mockApplicationFactory(overrides)
})

vi.mock('../pi/piConnectionSignature', () => ({
  capturePiConnectionSnapshot: mocks.capture,
  PiInvalidConnectionSnapshotError: class extends Error {}
}))

vi.mock('../pi/gatewayModelBinding', () => ({ createPiGatewayModelBinding: mocks.binding }))
vi.mock('@main/ai/agents/prompt/buildAgentPrompt', () => ({ buildAgentPrompt: mocks.prompt }))
vi.mock('@main/ai/runtime/agentMcpServers', () => ({
  warmAgentMcpToolCatalogs: async () => {},
  buildAgentMcpServers: mocks.mcpServers
}))
vi.mock('@main/utils/shellEnv', () => ({
  getShellEnv: vi.fn(async (): Promise<Record<string, string>> => ({})),
  getPathFromEnvironment: () => undefined
}))

const originalPrepareDurableDesktop = durableDesktopModule.prepareDurableDesktop

function encodeNativeEntry(...args: Parameters<typeof encodeEntry>) {
  return copyJson(encodeEntry(...args)) as JsonRepresentation<ReturnType<typeof encodeEntry>>
}

function gate() {
  let resolveReached!: () => void
  let resolveOpen!: () => void
  const reached = new Promise<void>((resolve) => {
    resolveReached = resolve
  })
  const opened = new Promise<void>((resolve) => {
    resolveOpen = resolve
  })
  return {
    reached,
    open: () => {
      resolveReached()
      resolveOpen()
    },
    wait: async <T>(value: T): Promise<T> => {
      resolveReached()
      await opened
      return value
    }
  }
}

beforeAll(() => checkCommand({ command: 'true', dialect: 'bash', permissionMode: 'default' }))

type PreparedDesktop = Awaited<ReturnType<typeof durableDesktopModule.prepareDurableDesktop>>

describe('DurableBackend retired resource reclamation', () => {
  const dbh = setupTestDatabase()
  let directory: string
  let agentId: string
  let input: AgentRuntimeConnectInput
  let snapshot: PiConnectionSnapshot
  let script: ReturnType<typeof scriptedModel>
  let driver: PiDurableRuntimeDriver
  const connections: PiDurableRuntimeConnection[] = []
  const createdDesktops: Array<{
    desktop: PreparedDesktop
    closeSpy: ReturnType<typeof vi.spyOn>
    originalClose: () => Promise<void>
  }> = []
  let mcpPingCount = 0

  const createMcpBridge = () =>
    ({
      automation: {
        id: 'automation',
        name: 'automation',
        async connect(transport: NonNullable<Parameters<typeof serveStdio>[1]>['transport']) {
          const server = new McpServer({ name: 'fixture-automation', version: '1' })
          server.registerTool(
            'ping',
            {
              description: 'ping automation',
              inputSchema: z.object({ tag: z.string() }),
              annotations: { readOnlyHint: true }
            },
            async ({ tag }) => {
              mcpPingCount++
              return { content: [{ type: 'text', text: `pong:${tag}` }] }
            }
          )
          return serveStdio(() => server, { transport })
        }
      }
    }) as unknown as ReturnType<typeof AgentMcpServers.buildAgentMcpServers>

  beforeEach(async () => {
    mcpPingCount = 0
    createdDesktops.length = 0
    driver = new PiDurableRuntimeDriver()
    runtimeDriverRegistry.register(driver)
    vi.mocked(getShellEnv).mockReset().mockResolvedValue({})
    mocks.interaction.mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    mocks.adopt.mockReset()
    directory = await realpath(tempDir('durable-retired'))
    vi.mocked(application.getPath).mockImplementation((key, file) => {
      const dir = join(directory, key)
      if (key !== 'external.pi.settings_file' && key !== 'feature.agents.pi.sessions')
        mkdirSync(dir, { recursive: true })
      return file ? join(dir, file) : dir
    })

    vi.spyOn(durableDesktopModule, 'prepareDurableDesktop').mockImplementation(async (...args) => {
      const desktop = await originalPrepareDurableDesktop(...args)
      const originalClose = desktop.close.bind(desktop)
      const closeSpy = vi.spyOn(desktop, 'close')
      createdDesktops.push({ desktop, closeSpy, originalClose })
      return desktop
    })

    agentId = uuid()
    const workspaceId = uuid()
    input = { sessionId: uuid(), agentId, modelId }
    dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', isEnabled: true, orderKey: 'a0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: modelId,
        providerId: 'test',
        modelId: 'test-model',
        name: 'Test',
        capabilities: ['function-call'],
        supportsStreaming: true,
        isEnabled: true,
        orderKey: 'a0'
      })
      .run()
    dbh.db
      .insert(agentTable)
      .values({
        id: agentId,
        name: 'Pi',
        type: 'pi-durable',
        model: modelId,
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
      .values({ id: input.sessionId, agentId, workspaceId, name: 'Primary', orderKey: 'a0' })
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
    mocks.capture.mockImplementation(async (sessionId: string) => ({
      ...snapshot,
      session: agentSessionService.getById(sessionId)
    }))
    mocks.mcpServers.mockImplementation(() => createMcpBridge())
    mocks.catalog.mockReset().mockReturnValue([])
    mocks.prompt.mockReset().mockResolvedValue({ base: { kind: 'custom', content: 'You are Cherry.' }, blocks: [] })
    script = scriptedModel([assistantReply('Hello world')])
    mocks.binding.mockImplementation(async (next: AgentRuntimeConnectInput, _provider, _model, _usage, shared) => {
      const model = { ...MODEL, provider: next.sessionId }
      if (!shared) return createTestBinding({ model, stream: (m, c, o) => script.model(m, c, o) })
      shared.registerProvider(model.provider, {
        api: model.api,
        apiKey: 'fixture',
        baseUrl: model.baseUrl,
        models: [model],
        streamSimple: (m, c, o) => script.model(m, c, o)
      })
      return { modelRuntime: shared, model: shared.getModel(model.provider, model.id)! }
    })
  })

  afterEach(async () => {
    try {
      runtimeDriverRegistry.clearForTest()
      for (const connection of connections.splice(0)) await connection.close()
    } finally {
      vi.restoreAllMocks()
    }
  })

  function messageFor(sessionId: string, text: string) {
    return messages.saveMessage({
      sessionId,
      message: { id: uuid(), role: 'user', data: { parts: [{ type: 'text', text }] } }
    })
  }

  async function connectFor(connectInput: AgentRuntimeConnectInput) {
    const connection = await driver.connect(connectInput)
    connections.push(connection)
    const events: AgentRuntimeEvent[] = []
    void (async () => {
      for await (const event of connection.events) events.push(event)
    })()
    return { connection, events }
  }

  async function done(events: AgentRuntimeEvent[], timeout = 10_000) {
    await expect
      .poll(() => events.some((event) => event.type === 'turn-complete' || event.type === 'error'), { timeout })
      .toBe(true)
  }

  async function savedAnswer(sessionId: string, current: Awaited<ReturnType<typeof connectFor>>) {
    await done(current.events)
    const complete = current.events.findLast((event) => event.type === 'turn-complete')!
    if (complete.type !== 'turn-complete' || !complete.forkAnchor) throw new Error('Missing checkpoint')
    return messages.saveMessage({
      sessionId,
      nativeContextId: current.connection.contextId,
      runtimeResumeToken: current.connection['handle']!.thread.id,
      runtimeAnchor: complete.forkAnchor,
      message: { id: uuid(), role: 'assistant', status: 'success', data: { parts: [{ type: 'text', text: 'done' }] } }
    })
  }

  function backendOf(backendId: string): DurableBackend {
    return driver['backends'].get(backendId)!.owner!
  }

  async function openSiblingPair() {
    const primaryId = input.sessionId
    const primary = await connectFor(input)
    await primary.connection.send({ message: messageFor(primaryId, 'seed') })
    const anchor = await savedAnswer(primaryId, primary)
    const siblingId = await new AgentSessionForkOperations().fork(primaryId, anchor.id)
    const siblingInput: AgentRuntimeConnectInput = { ...input, sessionId: siblingId }
    const sibling = await connectFor(siblingInput)
    const primaryContext = contexts.context(primary.connection.contextId!)
    const owner = backendOf(primaryContext.backendId)
    return { primaryId, primary, siblingId, siblingInput, sibling, owner, primaryContext }
  }

  it('reclaims retired desktops and extensions across repeated rebuilds while sibling root tools keep working', async () => {
    const { primaryId, primary, siblingId, sibling, owner } = await openSiblingPair()
    const registry = owner['registry']
    const baselineExtensions = registry.snapshot().installed().length
    const extensionsPerRoot = createdDesktops[0].desktop.registry.snapshot().installed().length
    expect(baselineExtensions).toBe(extensionsPerRoot * 2)

    let activePrimary = primary
    let activePrimaryDesktop = createdDesktops[0]
    const retiredExtensionNames: string[] = []

    for (let round = 1; round <= 3; round++) {
      const previousDesktop = activePrimaryDesktop
      const previousNames = previousDesktop.desktop.registry
        .snapshot()
        .installed()
        .map((ext) => ext.name)
      retiredExtensionNames.push(...previousNames)

      // Close only primary; sibling stays connected so backend does NOT shut down.
      await activePrimary.connection.close()
      connections.splice(connections.indexOf(activePrimary.connection), 1)

      const rebuiltInput: AgentRuntimeConnectInput = {
        ...input,
        sessionId: primaryId,
        reasoningEffort: round % 2 === 0 ? 'low' : 'high'
      }
      activePrimary = await connectFor(rebuiltInput)
      activePrimaryDesktop = createdDesktops[createdDesktops.length - 1]

      // Pre-fix failure: old desktop was pushed to retired and never closed/uninstalled until backend shutdown.
      expect(previousDesktop.closeSpy).toHaveBeenCalledTimes(1)
      expect([...owner['retired']]).toHaveLength(0)

      const installedNames = registry
        .snapshot()
        .installed()
        .map((ext) => ext.name)
      for (const oldName of retiredExtensionNames) expect(installedNames).not.toContain(oldName)
      expect(installedNames).toHaveLength(baselineExtensions)
    }

    // Sibling root's coding + MCP tools still execute after all primary rebuilds.
    script = respondingModel((call) => {
      const results = call.messages.filter((entry) => entry.role === 'toolResult')
      if (results.length === 0) {
        return assistantReply(
          [
            toolCallPart('sib-write', 'write', { path: 'sibling-ok.txt', content: 'alive' }),
            toolCallPart('sib-ping', 'mcp__automation__ping', { tag: 'sib' })
          ],
          'toolUse'
        )
      }
      return assistantReply('sibling tools complete')
    })
    sibling.events.length = 0
    await sibling.connection.send({ message: messageFor(siblingId, 'verify sibling tools') })
    await done(sibling.events)
    expect(existsSync(join(directory, 'sibling-ok.txt'))).toBe(true)
    expect(readFileSync(join(directory, 'sibling-ok.txt'), 'utf8')).toBe('alive')
    expect(mcpPingCount).toBe(1)
    expect(sibling.events.filter((event) => event.type === 'error')).toEqual([])
  })

  it('preserves working coding and MCP tools for completed child and grandchild after root replacement', async () => {
    let rootSessionId = ''
    let childCalls = 0
    script = respondingModel((call) => {
      rootSessionId ||= call.sessionId!
      if (call.sessionId !== rootSessionId) {
        childCalls++
        if (childCalls === 1) return assistantReply('child initial done')
        const results = call.messages.filter((entry) => entry.role === 'toolResult')
        if (results.length === 0) {
          return assistantReply(
            [
              toolCallPart('child-write', 'write', { path: 'child-after-rebuild.txt', content: 'child-ok' }),
              toolCallPart('child-mcp', 'mcp__automation__ping', { tag: 'child' })
            ],
            'toolUse'
          )
        }
        return assistantReply('child tools ok')
      }
      if (!call.messages.some((entry) => entry.role === 'toolResult')) {
        return assistantReply(
          [
            subagentCall('spawn-child', {
              description: 'worker',
              prompt: 'initial work',
              background: true,
              fork: false
            })
          ],
          'toolUse'
        )
      }
      return assistantReply('root done')
    })

    const primaryId = input.sessionId
    const primary = await connectFor(input)
    await primary.connection.send({ message: messageFor(primaryId, 'spawn worker') })
    await done(primary.events, 10_000)

    // Wait for child to finish & capture its contextId and native conversation id.
    await expect.poll(() => contexts.children(primary.connection.contextId!).length, { timeout: 10_000 }).toBe(1)
    const childContext = contexts.children(primary.connection.contextId!)[0]
    const childConvId = Number(childContext.nativeThreadId!) as ConversationId
    const owner = backendOf(
      primary.connection.contextId ? contexts.context(primary.connection.contextId).backendId : ''
    )

    // Wait for child to be completely idle before creating grandchild under child.
    await expect
      .poll(
        async () => {
          const active = await owner.runtime.durable.commit(
            async (tx) =>
              (await tx.scanTasks({ conversationId: childConvId }, 256)).items.filter(
                (t) => t.state.status !== 'terminal'
              ),
            BACKGROUND_CONTEXT
          )
          return active.length
        },
        { timeout: 10_000 }
      )
      .toBe(0)

    // Create a completed grandchild conversation under childConvId and a sibling root to keep backend alive.
    const gcTask = defineTask<null, { phase: 'run' }, null>({
      name: 'test.grandchild-owner',
      version: 1,
      initial: () => ({ phase: 'run' }),
      phases: {
        async run(_task, runtime, ctx) {
          await runtime.commit(
            async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
            ctx
          )
        }
      },
      async abort(_task, runtime, ctx) {
        await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
      }
    })
    owner['registry'].install(defineExtension({ name: 'test.grandchild', tasks: [gcTask] }))
    const grandchildConvId = await owner.runtime.durable.commit(async (tx) => {
      const forkAt = (await tx.latestEntryId(childConvId))!
      const originToolTaskId = await tx.createTask(
        ToolTask,
        { kind: 'model', assistant: forkAt, callId: 'spawn-gc', unoffered: true },
        { conversationId: childConvId, ownership: { kind: 'conversation' }, background: true }
      )
      const ownerTaskId = await tx.createTask(gcTask, null, {
        conversationId: childConvId,
        ownership: { kind: 'conversation' },
        background: true
      })
      const gc = await tx.forkConversation(childConvId, forkAt, { ownership: { kind: 'task', taskId: ownerTaskId } })
      const origin = {
        parentToolCallId: String(originToolTaskId),
        fork: false,
        description: 'grandchild-worker',
        modelKey: 'test::test-model'
      }
      await tx.appendEntry(gc.id, encodeNativeEntry({ type: 'subagent-origin', value: origin }, 'gc-origin'))
      await tx.appendEntry(
        childConvId,
        encodeNativeEntry(
          {
            type: 'subagent-run',
            value: {
              ...origin,
              background: true,
              run: 1,
              status: 'finished',
              outcome: 'completed',
              sessionId: runtimeId(String(gc.id))
            }
          },
          'gc-origin'
        )
      )
      return gc.id
    }, BACKGROUND_CONTEXT)
    await owner.runtime.settled()

    // Fork a sibling root and connect so rebuilding primary leaves the backend alive.
    const anchor = await savedAnswer(primaryId, primary)
    const siblingId = await new AgentSessionForkOperations().fork(primaryId, anchor.id)
    await connectFor({ ...input, sessionId: siblingId })

    // Rebuild primary.
    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)
    const rebuilt = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })
    expect(createdDesktops[0].closeSpy).toHaveBeenCalledTimes(1)

    // Verify child and grandchild AgentDoc kept cherry.behavior and switched to the new namespace.
    const currentExtNames = createdDesktops[createdDesktops.length - 1].desktop.registry
      .snapshot()
      .installed()
      .map((ext) => ext.name)
    const [childExtensions, gcExtensions] = await owner.runtime.durable.commit(async (tx) => {
      const childDoc = await tx.doc(AgentDoc, childConvId)
      const gcDoc = await tx.doc(AgentDoc, grandchildConvId)
      return [
        Array.isArray(childDoc.extensions) ? [...childDoc.extensions] : childDoc.extensions,
        Array.isArray(gcDoc.extensions) ? [...gcDoc.extensions] : gcDoc.extensions
      ]
    }, BACKGROUND_CONTEXT)
    expect(childExtensions).toEqual([...currentExtNames, 'cherry.behavior'])
    expect(gcExtensions).toEqual([...currentExtNames, 'cherry.behavior'])

    // Execute coding + MCP tools on the completed child after replacement.
    await rebuilt.connection.messageChild(childContext.id, 'run child tools')
    await expect.poll(() => existsSync(join(directory, 'child-after-rebuild.txt')), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(join(directory, 'child-after-rebuild.txt'), 'utf8')).toBe('child-ok')
    expect(mcpPingCount).toBe(1)

    // Execute coding + MCP tools on the grandchild via observeChild -> messageChild after replacement.
    const gcResource = await rebuilt.connection['observeChild'](String(grandchildConvId))
    expect(gcResource).toBeDefined()
    script = respondingModel((call) => {
      const results = call.messages.filter((entry) => entry.role === 'toolResult')
      if (results.length === 0) {
        return assistantReply(
          [
            toolCallPart('gc-write', 'write', { path: 'grandchild-after-rebuild.txt', content: 'gc-ok' }),
            toolCallPart('gc-mcp', 'mcp__automation__ping', { tag: 'gc' })
          ],
          'toolUse'
        )
      }
      return assistantReply('grandchild tools ok')
    })
    const gcConversation = await (owner.runtime.durable as unknown as Harness).conversation(
      grandchildConvId,
      BACKGROUND_CONTEXT
    )
    expect(gcConversation).toBeDefined()
    const gcSubmission = await gcConversation!.submit({ type: 'input', content: 'run gc tools' }, BACKGROUND_CONTEXT)
    await gcSubmission.wait(BACKGROUND_CONTEXT)
    await expect.poll(() => existsSync(join(directory, 'grandchild-after-rebuild.txt')), { timeout: 10_000 }).toBe(true)
    expect(readFileSync(join(directory, 'grandchild-after-rebuild.txt'), 'utf8')).toBe('gc-ok')
    expect(mcpPingCount).toBe(2)
  })

  it.each(['pending', 'running', 'waiting', 'sleeping', 'completing'] as const)(
    'defers reclamation while a grandchild has a %s task and reclaims automatically once terminal',
    async (status) => {
      const { primaryId, primary, siblingId, sibling, owner, primaryContext } = await openSiblingPair()
      const rootConvId = Number(primaryContext.nativeThreadId!) as ConversationId

      // Pause scheduler or gate execution cleanly per status on a grandchild conversation.
      const release = gate()
      const blockerStarted = gate()
      const leafStarted = gate()

      const leafTask = defineTask<null, { phase: 'run' }, null>({
        name: `test.leaf-${status}`,
        version: 1,
        initial: () => ({ phase: 'run' }),
        phases: {
          async run(_task, runtime, ctx) {
            leafStarted.open()
            await release.wait(undefined)
            await runtime.commit(
              async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
              ctx
            )
          }
        },
        async abort(_task, runtime, ctx) {
          release.open()
          await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
        }
      })

      const blockerTask = defineTask<null, { phase: 'run' | 'resume' }, null>({
        name: `test.blocker-${status}`,
        version: 1,
        initial: () => ({ phase: 'run' }),
        phases: {
          async run(_task, runtime, ctx) {
            if (status === 'running') {
              blockerStarted.open()
              await release.wait(undefined)
              await runtime.commit(
                async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
                ctx
              )
              return
            }
            if (status === 'sleeping') {
              await runtime.commit(
                async () => ({
                  status: 'sleeping',
                  until: Date.now() + 60_000,
                  checkpoint: { phase: 'resume' }
                }),
                ctx
              )
              blockerStarted.open()
              return
            }
            if (status === 'completing') {
              await runtime.commit(async (tx) => {
                await tx.createTask(leafTask, null, { ownership: { kind: 'task', taskId: runtime.taskId } })
              }, ctx)
              await runtime.commit(
                async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
                ctx
              )
              blockerStarted.open()
            }
          },
          async resume(_task, runtime, ctx) {
            await runtime.commit(
              async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
              ctx
            )
          }
        },
        async abort(_task, runtime, ctx) {
          release.open()
          await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
        }
      })

      // Use clean separate task definition for `waiting` where tx.createTask returns the dep taskId before returning state.
      const waitingTask = defineTask<null, { phase: 'run' | 'resume' }, null>({
        name: `test.waiting-${status}`,
        version: 1,
        initial: () => ({ phase: 'run' }),
        phases: {
          async run(_task, runtime, ctx) {
            await runtime.commit(async (tx) => {
              const dep = await tx.createTask(leafTask, null, { ownership: { kind: 'task', taskId: runtime.taskId } })
              return { status: 'waiting', checkpoint: { phase: 'resume' }, on: [dep], policy: 'allSettled' }
            }, ctx)
            blockerStarted.open()
          },
          async resume(_task, runtime, ctx) {
            await runtime.commit(
              async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
              ctx
            )
          }
        },
        async abort(_task, runtime, ctx) {
          await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
        }
      })

      const ownerSetupTask = defineTask<null, { phase: 'run' }, null>({
        name: `test.owner-${status}`,
        version: 1,
        initial: () => ({ phase: 'run' }),
        phases: {
          async run(_task, runtime, ctx) {
            await runtime.commit(
              async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
              ctx
            )
          }
        },
        async abort(_task, runtime, ctx) {
          await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
        }
      })

      owner['registry'].install(
        defineExtension({ name: `test.ext-${status}`, tasks: [leafTask, blockerTask, waitingTask, ownerSetupTask] })
      )

      const { gcId, blockerId } = await owner.runtime.durable.commit(async (tx) => {
        const childOwner = await tx.createTask(ownerSetupTask, null, {
          conversationId: rootConvId,
          ownership: { kind: 'conversation' },
          background: true
        })
        const child = await tx.createConversation({ ownership: { kind: 'task', taskId: childOwner } })
        const gcOwner = await tx.createTask(ownerSetupTask, null, {
          conversationId: child.id,
          ownership: { kind: 'conversation' },
          background: true
        })
        const gc = await tx.createConversation({ ownership: { kind: 'task', taskId: gcOwner } })

        let taskId: TaskId
        if (status === 'pending') {
          // For `pending`, sleep/gate is NOT needed: create a sleeping parent? No, scheduler is running!
          // To hold `pending` deterministically across `connectFor`, put an `ownership: { kind: 'task' }` or
          // create a task whose `kind` is temporarily unregistered during rebuild, OR gate on sibling?
          // Wait: `blockerTask` with unregistered kind wouldn't be `pending`? No, it IS `pending` in storage!
          // Let's check: in storage, `tx.createTask` writes `status: 'pending'`!
          // If the task kind is NOT registered yet until we want it to complete, `status` stays `'pending'` in DB!
          const pendingOnly = defineTask<null, { phase: 'run' }, null>({
            name: `test.pending-unregistered-${status}`,
            version: 1,
            initial: () => ({ phase: 'run' }),
            phases: {
              async run(_t, runtime, ctx) {
                await runtime.commit(
                  async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
                  ctx
                )
              }
            },
            async abort(_t, runtime, ctx) {
              await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
            }
          })
          taskId = await tx.createTask(pendingOnly, null, {
            conversationId: gc.id,
            ownership: { kind: 'conversation' },
            background: true
          })
        } else {
          taskId = await tx.createTask(status === 'waiting' ? waitingTask : blockerTask, null, {
            conversationId: gc.id,
            ownership: { kind: 'conversation' },
            background: true
          })
        }
        return { gcId: gc.id, blockerId: taskId }
      }, BACKGROUND_CONTEXT)

      // Ensure ownerSetupTasks finish and our target non-terminal state is reached before rebuilding.
      if (status === 'waiting' || status === 'completing') {
        await blockerStarted.reached
        await leafStarted.reached
      } else if (status === 'running' || status === 'sleeping') {
        await blockerStarted.reached
      }
      await expect
        .poll(
          async () => {
            const record = await owner.runtime.durable.commit((tx) => tx.task(blockerId), BACKGROUND_CONTEXT)
            return record?.state.status
          },
          { timeout: 10_000 }
        )
        .toBe(status)

      const primaryDesktop = createdDesktops[0]
      await primary.connection.close()
      connections.splice(connections.indexOf(primary.connection), 1)
      const rebuilt = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })

      // Must NOT reclaim while grandchild task is in `status`.
      expect(primaryDesktop.closeSpy).not.toHaveBeenCalled()
      expect([...owner['retired']]).toHaveLength(1)
      const oldExtName = primaryDesktop.desktop.registry.snapshot().installed()[0].name
      expect(owner['registry'].snapshot().extension(oldExtName)).toBeDefined()

      // Also verify sibling root's active task does NOT block an idle root in the companion test; here
      // transition the grandchild blocker to terminal WITHOUT rebuilding or shutting down!
      if (status === 'pending') {
        const pendingOnly = defineTask<null, { phase: 'run' }, null>({
          name: `test.pending-unregistered-${status}`,
          version: 1,
          initial: () => ({ phase: 'run' }),
          phases: {
            async run(_t, runtime, ctx) {
              await runtime.commit(
                async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
                ctx
              )
            }
          },
          async abort(_t, runtime, ctx) {
            await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
          }
        })
        owner['registry'].install(defineExtension({ name: `test.pending-enable-${status}`, tasks: [pendingOnly] }))
      } else if (status === 'sleeping') {
        await (owner.runtime.durable as unknown as Harness).abortTask(blockerId, BACKGROUND_CONTEXT)
      }
      release.open()
      void gcId
      void sibling
      void siblingId
      void rebuilt

      await expect.poll(() => primaryDesktop.closeSpy.mock.calls.length, { timeout: 10_000 }).toBe(1)
      expect([...owner['retired']]).toHaveLength(0)
      expect(owner['registry'].snapshot().extension(oldExtName)).toBeUndefined()
    }
  )

  it('allows an idle root to reclaim while a sibling root has an active non-terminal task', async () => {
    const { primaryId, primary, siblingId, owner } = await openSiblingPair()
    const siblingNativeId = Number(
      contexts.context(siblingId ? prepareDurableBranch(siblingId).id : '').nativeThreadId!
    ) as ConversationId
    const heldTask = gate()
    const started = gate()
    const siblingTask = defineTask<null, { phase: 'run' }, null>({
      name: 'test.sibling-active',
      version: 1,
      initial: () => ({ phase: 'run' }),
      phases: {
        async run(_t, runtime, ctx) {
          started.open()
          await heldTask.wait(undefined)
          await runtime.commit(
            async () => ({ status: 'terminal', outcome: { status: 'completed', result: null } }),
            ctx
          )
        }
      },
      async abort(_t, runtime, ctx) {
        await runtime.commit(async () => ({ status: 'terminal', outcome: { status: 'aborted' } }), ctx)
      }
    })
    owner['registry'].install(defineExtension({ name: 'test.sibling-active-ext', tasks: [siblingTask] }))
    await owner.runtime.durable.commit(
      (tx) =>
        tx.createTask(siblingTask, null, {
          conversationId: siblingNativeId,
          ownership: { kind: 'conversation' },
          background: true
        }),
      BACKGROUND_CONTEXT
    )
    await started.reached

    const primaryDesktop = createdDesktops[0]
    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)
    await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })

    expect(primaryDesktop.closeSpy).toHaveBeenCalledTimes(1)
    expect([...owner['retired']]).toHaveLength(0)
    heldTask.open()
  })

  it('reclaims automatically after a deferred real background subagent settles without rebuild or shutdown', async () => {
    const childGate = gate()
    let root = ''
    script = respondingModel(async (call) => {
      root ||= call.sessionId!
      if (call.sessionId !== root) {
        await childGate.wait(undefined)
        return assistantReply('child finished late')
      }
      if (!call.messages.some((entry) => entry.role === 'toolResult')) {
        return assistantReply(
          [subagentCall('spawn', { description: 'bg', prompt: 'work', background: true, fork: false })],
          'toolUse'
        )
      }
      return assistantReply('parent summary')
    })

    const { primaryId, primary, owner } = await openSiblingPair()
    const primaryDesktop = createdDesktops[0]

    // Start background child on primary, then let primary's first turn complete while child is gated!
    await primary.connection.send({ message: messageFor(primaryId, 'start background work') })
    await childGate.reached
    await done(primary.events)

    // Rebuild primary while child + background subagent work is still active.
    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)
    await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })

    // Deferred while child is active.
    expect(primaryDesktop.closeSpy).not.toHaveBeenCalled()
    expect([...owner['retired']]).toHaveLength(1)

    // Release child -> child finishes + notification summary runs -> backend automatically reclaims with NO rebuild/shutdown!
    childGate.open()
    await expect.poll(() => primaryDesktop.closeSpy.mock.calls.length, { timeout: 10_000 }).toBe(1)
    expect([...owner['retired']]).toHaveLength(0)
  })

  it('preserves old resources when configure fails and retries failed desktop.close without double-closing', async () => {
    const { primaryId, primary, owner } = await openSiblingPair()
    const firstDesktop = createdDesktops[0]
    const staleRoot = primary.connection['access']!.root
    const firstNames = firstDesktop.desktop.registry
      .snapshot()
      .installed()
      .map((ext) => ext.name)

    // 1. Simulate configure failure on rebuild.
    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)
    const openSpy = owner.runtime.open.bind(owner.runtime)
    vi.spyOn(owner.runtime, 'open').mockImplementationOnce(async (ref) => {
      const res = await openSpy(ref)
      if (res.status === 'confirmed') {
        vi.spyOn(res.value.durable, 'configure').mockRejectedValueOnce(new Error('configure failed'))
      }
      return res
    })
    await expect(connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'low' })).rejects.toThrow(
      'configure failed'
    )
    await owner.reclaimRetired(staleRoot)
    expect(firstDesktop.closeSpy).not.toHaveBeenCalled()
    for (const name of firstNames) expect(owner['registry'].snapshot().extension(name)).toBeDefined()

    // 2. Next successful rebuild: simulate MCP close rejecting once on the retired desktop from failed attempt.
    //    Retained ownership in `retired` allows retry without double-closing any already-closed desktop.
    const secondDesktop = createdDesktops[createdDesktops.length - 1]
    vi.spyOn(firstDesktop.desktop.mcp, 'close').mockRejectedValueOnce(new Error('mcp transport stuck'))

    const active = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })
    expect(firstDesktop.closeSpy).toHaveBeenCalledTimes(1)
    expect(secondDesktop.closeSpy).toHaveBeenCalledTimes(1)
    // firstDesktop failed close -> MUST remain in retired; secondDesktop succeeded -> removed!
    expect([...owner['retired']].map((r) => r.desktop)).toEqual([firstDesktop.desktop])

    // Calling reclaimRetired again retries firstDesktop and never double-closes secondDesktop!
    await owner.reclaimRetired(active.connection['access']!.root)
    expect(firstDesktop.closeSpy).toHaveBeenCalledTimes(2)
    expect(secondDesktop.closeSpy).toHaveBeenCalledTimes(1)
    expect([...owner['retired']]).toHaveLength(0)
  })

  it('keeps the last configured root and reclaims automatically after a failed rebuild', async () => {
    const { primaryId, primary, owner, primaryContext } = await openSiblingPair()
    const finish = gate()
    const blocker = defineTask<null, { phase: 'run' }, null>({
      name: 'test.failed-rebuild-blocker',
      version: 1,
      initial: () => ({ phase: 'run' }),
      phases: {
        async run(_task, runtime, context) {
          await finish.wait(undefined)
          await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'completed', result: null } }), context)
        }
      },
      async abort(_task, runtime, context) {
        await runtime.commit(() => ({ status: 'terminal', outcome: { status: 'aborted' } }), context)
      }
    })
    owner['registry'].install(defineExtension({ name: 'test.failed-rebuild', tasks: [blocker] }))
    await owner.runtime.durable.commit(
      (tx) =>
        tx.createTask(blocker, null, {
          conversationId: Number(primaryContext.nativeThreadId) as ConversationId,
          ownership: { kind: 'conversation' },
          background: true
        }),
      BACKGROUND_CONTEXT
    )

    try {
      await finish.reached
      await primary.connection.close()
      const rebuilt = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })
      const currentRoot = rebuilt.connection['access']!.root
      await rebuilt.connection.close()
      expect(createdDesktops[0].closeSpy).not.toHaveBeenCalled()

      const open = owner.runtime.open.bind(owner.runtime)
      vi.spyOn(owner.runtime, 'open').mockImplementationOnce(async (ref) => {
        const opened = await open(ref)
        if (opened.status === 'confirmed') {
          const configure = opened.value.durable.configure.bind(opened.value.durable)
          vi.spyOn(opened.value.durable, 'configure').mockImplementationOnce((change) => {
            vi.spyOn(owner.runtime.durable, 'commit').mockRejectedValueOnce(new Error('configure failed'))
            return configure(change)
          })
        }
        return opened
      })
      await expect(connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'low' })).rejects.toThrow(
        'configure failed'
      )

      const [first, , current, failed] = createdDesktops
      expect(owner['roots'].get(primaryContext.id)).toBe(currentRoot)
      expect(first.closeSpy).not.toHaveBeenCalled()

      finish.open()
      await expect.poll(() => owner['retired'].size, { timeout: 10_000 }).toBe(0)
      expect(first.closeSpy).toHaveBeenCalledTimes(1)
      expect(failed.closeSpy).toHaveBeenCalledTimes(1)
      expect(current.closeSpy).not.toHaveBeenCalled()
      const installed = owner['registry'].snapshot()
      for (const { desktop } of [first, failed])
        for (const extension of desktop.registry.snapshot().installed()) {
          expect(installed.extension(extension.name)).toBeUndefined()
        }
      for (const extension of current.desktop.registry.snapshot().installed()) {
        expect(installed.extension(extension.name)).toBe(extension)
      }
    } finally {
      finish.open()
    }
  })

  it('closes current and retired desktops after native shutdown fails and retries failed desktop closes', async () => {
    const { primaryId, primary, owner } = await openSiblingPair()
    const first = createdDesktops[0]
    const closeMcp = vi.spyOn(first.desktop.mcp, 'close').mockRejectedValueOnce(new Error('retired transport stuck'))
    await primary.connection.close()
    await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })
    expect([...owner['retired']].map((root) => root.desktop)).toEqual([first.desktop])

    vi.spyOn(SqliteStorage.prototype, 'scanConversations').mockRejectedValueOnce(new Error('native storage failed'))
    const native = owner.runtime.durable as Harness
    await expect(native.commit((tx) => tx.scanConversations({}, 1), BACKGROUND_CONTEXT)).rejects.toThrow(
      'native storage failed'
    )
    await expect(native.commit(() => {}, BACKGROUND_CONTEXT)).rejects.toMatchObject({ name: 'SessionFailed' })
    await expect(owner.runtime.shutdown()).resolves.toMatchObject({ status: 'unknown' })

    const [, sibling, current] = createdDesktops
    closeMcp.mockRejectedValueOnce(new Error('retired transport still stuck'))
    await expect(owner.shutdown()).rejects.toThrow('retired transport still stuck')
    expect(sibling.closeSpy).toHaveBeenCalledTimes(1)
    expect(current.closeSpy).toHaveBeenCalledTimes(1)
    expect(first.closeSpy).toHaveBeenCalledTimes(2)
    expect([...owner['retired']].map((root) => root.desktop)).toEqual([first.desktop])

    await owner.shutdown()
    expect(sibling.closeSpy).toHaveBeenCalledTimes(1)
    expect(current.closeSpy).toHaveBeenCalledTimes(1)
    expect(first.closeSpy).toHaveBeenCalledTimes(3)
    expect(owner['retired'].size).toBe(0)
  })

  it('serializes overlapping reclaimRetired and shutdown without double-closing and ignores stale generations', async () => {
    const { primaryId, primary, owner } = await openSiblingPair()
    const firstDesktop = createdDesktops[0]
    const staleRoot = primary.connection['access']!.root

    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)
    const rebuilt = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })
    const currentRoot = rebuilt.connection['access']!.root
    expect(firstDesktop.closeSpy).toHaveBeenCalledTimes(1)

    // Calling reclaimRetired with staleRoot must be a strict no-op even if another retired host exists.
    await primary.connection.close().catch(() => {})
    await rebuilt.connection.close()
    connections.splice(connections.indexOf(rebuilt.connection), 1)
    const third = await connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'low' })
    const secondDesktop = createdDesktops[2]
    expect(secondDesktop.closeSpy).toHaveBeenCalledTimes(1)

    // Prepare a slow close on a new rebuild so reclaimRetired overlaps shutdown.
    await third.connection.close()
    connections.splice(connections.indexOf(third.connection), 1)
    const thirdDesktop = createdDesktops[createdDesktops.length - 1]
    const closeGate = gate()
    const allowClose = gate()
    const origClose = thirdDesktop.originalClose
    let closeCalls = 0
    thirdDesktop.closeSpy.mockImplementation(async () => {
      closeCalls++
      closeGate.open()
      await allowClose.wait(undefined)
      return origClose()
    })

    // Hold the retired desktop's close while competing reclamations and shutdown start.
    const fourthPromise = connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'medium' })
    await closeGate.reached
    const p1 = owner.reclaimRetired(staleRoot)
    const p2 = owner.reclaimRetired(owner['roots'].get(currentRoot.context.id)!)
    const shutdownPromise = owner.shutdown()
    allowClose.open()

    const fourth = await fourthPromise
    await Promise.all([p1, p2, shutdownPromise])
    await expect(owner.reclaimRetired(fourth.connection['access']!.root)).resolves.toBeUndefined()
    connections.length = 0

    expect(closeCalls).toBe(1)
    expect(firstDesktop.closeSpy).toHaveBeenCalledTimes(1)
    expect(secondDesktop.closeSpy).toHaveBeenCalledTimes(1)
  })

  it('reclaims replaced desktop when connection start fails after configure before reclaimRetired', async () => {
    const { primaryId, primary, sibling, owner } = await openSiblingPair()
    const [first, siblingDesktop] = createdDesktops
    await primary.connection.close()
    connections.splice(connections.indexOf(primary.connection), 1)

    const origOpen = owner.runtime.open
    vi.spyOn(owner.runtime, 'open').mockImplementationOnce(async (ref) => {
      const opened = await origOpen(ref)
      if (opened.status === 'confirmed') {
        vi.spyOn(opened.value.durable, 'observe').mockResolvedValueOnce({
          status: 'unknown',
          error: { operation: 'observe', code: 'native-error', message: 'observe failed' }
        } as never)
      }
      return opened
    })

    await expect(connectFor({ ...input, sessionId: primaryId, reasoningEffort: 'high' })).rejects.toThrow(
      'observe failed'
    )

    expect(siblingDesktop.closeSpy).not.toHaveBeenCalled()
    expect(first.closeSpy).toHaveBeenCalledTimes(1)
    expect(owner['retired'].size).toBe(0)
    const installed = owner['registry'].snapshot()
    for (const extension of first.desktop.registry.snapshot().installed()) {
      expect(installed.extension(extension.name)).toBeUndefined()
    }
    expect(sibling.connection.contextId).toBeTruthy()
  })
})
