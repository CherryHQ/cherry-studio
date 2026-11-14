import { InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { createMcpSkillsFixture } from '@test-helpers/mcpSkills'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as z from 'zod'

import { application } from '@application'
import {
  callKeyOf,
  createFakeHarness,
  createScriptedHost,
  install,
  type GateHandlers
} from '@cherrystudio/agent-behavior'
import { agentTable } from '@data/db/schemas/agent'
import { agentSessionTable } from '@data/db/schemas/agentSession'
import { agentWorkspaceTable } from '@data/db/schemas/agentWorkspace'
import { agentMcpServerTable } from '@data/db/schemas/assistantRelations'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { mcpServerService } from '@data/services/McpServerService'
import { AgentSessionRuntimeService } from '@main/ai/agentSession/AgentSessionRuntimeService'
import { ClientMcpConnection } from '@main/ai/mcp/connections/ClientMcpConnection'
import type { McpConnection } from '@main/ai/mcp/connections/McpConnection'
import { McpCatalogService } from '@main/ai/mcp/McpCatalogService'
import { McpRuntimeService } from '@main/ai/mcp/McpRuntimeService'
import { createSkillsServer } from '@main/ai/mcp/servers/skills'
import { CLAUDE_TOOL_GUARD_RULES } from '@main/ai/runtime/claudeCode/guardRules'
import type { PiApprovalContext } from '@main/ai/runtime/pi/piApprovalFacts'
import { createPiInteractionPorts } from '@main/ai/runtime/pi/piBehaviorHost'
import { buildPiMcpToolName } from '@main/ai/runtime/pi/piMcpExtension'
import { listBuiltinToolPolicies } from '@main/ai/toolApproval/builtinToolPolicy'
import { toolApprovalRegistry, type DispatchDecision } from '@main/ai/toolApproval/ToolApprovalRegistry'
import { evaluateToolGuards } from '@main/ai/toolApproval/toolGuards'
import { BaseService } from '@main/core/lifecycle'
import { createUniqueModelId } from '@shared/data/types/model'
import { IpcChannel } from '@shared/IpcChannel'

import { McpSkillService } from '../McpSkillService'

const transport = vi.hoisted(() => ({ connect: vi.fn<() => Promise<McpConnection>>() }))
vi.mock('@main/ai/mcp/connections/ExternalMcpConnection', () => ({ createExternalMcpConnection: transport.connect }))

const sessionId = 'skill-session'
const agentId = 'skill-agent'
const messageId = '019a0000-0000-7000-8000-000000000001'

describe('session MCP skills through real protocol and persistence', () => {
  const dbh = setupTestDatabase()
  let skills: McpSkillService
  let runtime: McpRuntimeService
  let fixture: ReturnType<typeof createMcpSkillsFixture>
  let serverId: string
  let interactive = true
  const decide =
    vi.fn<
      (sessionId: string, request: { signal: AbortSignal; input: Record<string, unknown> }) => Promise<DispatchDecision>
    >()

  beforeEach(async () => {
    BaseService.resetInstances()
    fixture = createMcpSkillsFixture()
    interactive = true
    dbh.db.insert(agentTable).values({ id: agentId, type: 'pi', name: 'Agent', instructions: '', orderKey: 'a0' }).run()
    dbh.db
      .insert(agentWorkspaceTable)
      .values({ id: 'workspace', name: 'Workspace', path: '/tmp/mcp-skill-test', type: 'user', orderKey: 'a0' })
      .run()
    dbh.db
      .insert(agentSessionTable)
      .values([
        { id: sessionId, name: 'Skills', agentId, workspaceId: 'workspace', orderKey: 'a0' },
        { id: 'other-session', name: 'Other', agentId, workspaceId: 'workspace', orderKey: 'a1' }
      ])
      .run()
    agentSessionMessageService.saveMessage({
      sessionId,
      message: {
        id: messageId,
        role: 'user',
        status: 'success',
        data: { parts: [{ type: 'text', text: 'Use reports' }] }
      }
    })
    const server = mcpServerService.create({
      name: 'Reports origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:1/mcp',
      isActive: true
    })
    serverId = server.id
    dbh.db.insert(agentMcpServerTable).values({ agentId, mcpServerId: serverId }).run()
    runtime = new McpRuntimeService()
    skills = new McpSkillService()
    const catalog = new McpCatalogService()
    const container = application.getContainer()
    const get = container.get.bind(container)
    vi.spyOn(container, 'get').mockImplementation((name) => {
      if (typeof name !== 'string') return get(name)
      const services: Record<string, unknown> = {
        McpRuntimeService: runtime,
        McpSkillService: skills,
        McpCatalogService: catalog,
        AgentSessionRuntimeService: {
          requestToolApproval: decide,
          getMcpInteractionHost: () =>
            interactive ? { windowId: 'window', topicId: sessionId, model: 'model' } : undefined,
          recordMcpSkillLoad: (id: string, skill: Parameters<typeof agentSessionMessageService.recordMcpSkill>[2]) =>
            agentSessionMessageService.recordMcpSkill(id, messageId, skill)
        }
      }
      return services[name] ?? get(name)
    })
    transport.connect.mockImplementation(async () => {
      const [client, peer] = InMemoryTransport.createLinkedPair()
      const handle = serveStdio(() => fixture.createServer(), { transport: peer, legacy: 'reject' })
      const connection = new ClientMcpConnection(
        { name: 'test', version: '1' },
        {
          capabilities: { elicitation: { form: {}, url: {} }, roots: {}, sampling: {} },
          versionNegotiation: { mode: { pin: '2026-07-28' } }
        },
        {
          toolsChanged: vi.fn(),
          promptsChanged: vi.fn(),
          resourcesChanged: vi.fn(),
          resourceUpdated: vi.fn(),
          log: vi.fn()
        }
      )
      connection.addCloseHook(() => handle.close())
      await connection.connect(client)
      return connection
    })
    decide.mockReset().mockImplementation(async () => ({ approved: interactive }))
    await runtime._doInit()
    await skills._doInit()
    skills.openSession(sessionId, agentId)
  })

  afterEach(async () => {
    await skills?._doStop()
    await runtime?._doStop()
    toolApprovalRegistry.clear()
    vi.restoreAllMocks()
  })

  it('loads metadata and SKILL.md together without prefetching supporting files or elicitation', async () => {
    expect((await skills.list(sessionId))[0].skills[0].serverId).toBe(serverId)
    expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual([])
    const loaded = await skills.load(sessionId, serverId, fixture.uri)
    expect(loaded.entry.resources).toHaveLength(2)
    expect(loaded.entry.serverId).toBe(serverId)
    expect(loaded.content.text).toContain('Read references/facts.txt')
    expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual([`read:${fixture.uri}`])
    expect(
      (await skills.read(sessionId, serverId, fixture.uri, 'skill://reports/references/facts.txt')).text
    ).toContain('CHERRY-2640')
    expect(agentSessionMessageService.getSessionMessage(sessionId, messageId).data).not.toHaveProperty('mcpSkills')
    agentSessionMessageService.updateSessionMessage(sessionId, messageId, {
      data: { parts: [{ type: 'text', text: 'edited' }], ...{ mcpSkills: [] } }
    })
    expect(agentSessionMessageService.listMcpSkills(sessionId)).toHaveLength(1)
  })

  it.each(['text', 'blob'])(
    'exposes readable %s entry content and preserves binary supporting files through tools',
    async (representation) => {
      const entryText = `${fixture.files.get(fixture.uri)}生成报告。\n`
      fixture.files.set(fixture.uri, representation === 'blob' ? Buffer.from(entryText) : entryText)
      const binaryUri = 'skill://reports/assets/data.bin'
      const binary = Buffer.from([0, 255, 128, 1])
      fixture.files.set(binaryUri, binary)
      fixture.refresh()
      const client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
      try {
        const catalog = await client.callTool({ name: 'list_mcp_skills', arguments: {} })
        expect(JSON.stringify(catalog)).toContain('reports')
        expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual([])
        const input = { server_id: serverId, skill_uri: fixture.uri }
        expect(
          await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'load', input })
        ).toBeUndefined()
        const load = await client.callTool({ name: 'load_mcp_skill', arguments: input })
        expect(load.isError).not.toBe(true)
        expect(JSON.stringify(load)).toContain('Read references/facts.txt')
        expect(JSON.stringify(load)).toContain(serverId)
        const block = load.content[0]
        if (block.type !== 'text') throw new Error('Expected a text tool result')
        expect(JSON.parse(block.text)).toMatchObject({
          entry: { ...fixture.manifest(), serverId },
          content: { uri: fixture.uri, text: entryText }
        })
        expect(JSON.parse(block.text).content).not.toHaveProperty('blob')
        expect((await skills.load(sessionId, serverId, fixture.uri)).content).toMatchObject({
          uri: fixture.uri,
          text: entryText
        })
        expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual([`read:${fixture.uri}`])
        const read = await client.callTool({
          name: 'read_mcp_skill_file',
          arguments: {
            server_id: serverId,
            skill_uri: fixture.uri,
            resource_uri: 'skill://reports/references/facts.txt'
          }
        })
        expect(JSON.stringify(read)).toContain('CHERRY-2640')
        const readBinary = await client.callTool({
          name: 'read_mcp_skill_file',
          arguments: { server_id: serverId, skill_uri: fixture.uri, resource_uri: binaryUri }
        })
        expect(readBinary.isError).not.toBe(true)
        const binaryBlock = readBinary.content[0]
        if (binaryBlock.type !== 'text') throw new Error('Expected a text tool result')
        expect(JSON.parse(binaryBlock.text)).toMatchObject({
          origin: { serverId, skillUri: fixture.uri },
          content: { uri: binaryUri, blob: binary.toString('base64') }
        })
        expect(JSON.parse(binaryBlock.text).content).not.toHaveProperty('text')
      } finally {
        await client.close()
      }
    }
  )

  it('rejects a reconfigured origin after authorization returns but before builtin execution', async () => {
    const input = { server_id: serverId, skill_uri: fixture.uri }
    expect(
      await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'gap', input })
    ).toBeUndefined()
    mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
    const client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
    try {
      const result = await client.callTool({ name: 'load_mcp_skill', arguments: input })
      expect(result.isError).toBe(true)
      expect(fixture.requests).toEqual([])
      expect(agentSessionMessageService.listMcpSkills(sessionId)).toEqual([])
    } finally {
      await client.close()
    }
  })

  it('does not let a new approval revive an old call or permit replay', async () => {
    const oldInput = { server_id: serverId, skill_uri: fixture.uri }
    await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'old', input: oldInput })
    mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
    const input = { server_id: serverId, skill_uri: fixture.uri }
    await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'fresh', input })
    const client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
    try {
      expect((await client.callTool({ name: 'load_mcp_skill', arguments: oldInput })).isError).toBe(true)
      expect(fixture.requests).toEqual([])
      const loaded = await client.callTool({ name: 'load_mcp_skill', arguments: input })
      expect(loaded.isError).not.toBe(true)
      expect(JSON.stringify(loaded)).toContain('Read references/facts.txt')
      const requests = [...fixture.requests]
      expect((await client.callTool({ name: 'load_mcp_skill', arguments: input })).isError).toBe(true)
      expect(fixture.requests).toEqual(requests)
    } finally {
      await client.close()
    }
  })

  it('rejects a changed load input and allows Full Access without a receipt', async () => {
    const input = { server_id: serverId, skill_uri: fixture.uri }
    await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'changed-input', input })
    const client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
    try {
      expect(
        (
          await client.callTool({
            name: 'load_mcp_skill',
            arguments: { ...input, skill_uri: 'skill://other/SKILL.md' }
          })
        ).isError
      ).toBe(true)
      expect(
        (await client.callTool({ name: 'load_mcp_skill', arguments: { server_id: serverId, skill_uri: fixture.uri } }))
          .isError
      ).toBe(true)
      expect(fixture.requests).toEqual([])
      agentService.updateAgent(agentId, { configuration: { permission_mode: 'bypassPermissions' } })
      const loaded = await client.callTool({
        name: 'load_mcp_skill',
        arguments: { server_id: serverId, skill_uri: fixture.uri }
      })
      expect(loaded.isError).not.toBe(true)
      expect(JSON.stringify(loaded)).toContain('Read references/facts.txt')
    } finally {
      await client.close()
    }
  })

  it('keeps the approved cancellation signal through the protocol response', async () => {
    const input = { server_id: serverId, skill_uri: fixture.uri }
    await authorizer(true)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'during-load', input })
    const received = Promise.withResolvers<void>()
    const release = Promise.withResolvers<void>()
    const getSkill = runtime.getSkill.bind(runtime)
    vi.spyOn(runtime, 'getSkill').mockImplementation(async (...args) => {
      const entry = await getSkill(...args)
      received.resolve()
      await release.promise
      return entry
    })
    const client = await connectMcpTestClient(() => createSkillsServer(agentId, sessionId))
    try {
      const loading = client.callTool({ name: 'load_mcp_skill', arguments: input })
      await received.promise
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:1/mcp' })
      release.resolve()
      expect((await loading).isError).toBe(true)
      expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual([])
      expect(agentSessionMessageService.listMcpSkills(sessionId)).toEqual([])
    } finally {
      release.resolve()
      await client.close()
    }
  })

  it('settles a cancelled cross-origin approval in persisted history before returning', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const other = mcpServerService.create({
      name: 'Other',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:3/mcp',
      isActive: true
    })
    dbh.db.insert(agentMcpServerTable).values({ agentId, mcpServerId: other.id }).run()
    dbh.db.insert(userProviderTable).values({ providerId: 'test', name: 'Test', orderKey: 'p0' }).run()
    dbh.db
      .insert(userModelTable)
      .values({
        id: createUniqueModelId('test', 'model'),
        providerId: 'test',
        modelId: 'model',
        name: 'Test model',
        capabilities: [],
        supportsStreaming: true,
        orderKey: 'm0'
      })
      .run()
    const host = new AgentSessionRuntimeService()
    host.beginTurn({
      sessionId,
      topicId: `agent-session:${sessionId}`,
      agentId,
      agentType: 'pi',
      modelId: createUniqueModelId('test', 'model'),
      assistantMessageId: '019a0000-0000-7000-8000-000000000002'
    })
    vi.spyOn(host, 'getInteractionState').mockReturnValue({ currentTurn: 'interactive', userResponse: 'stream' })
    decide.mockImplementation((id, request) =>
      host.requestToolApproval(id, { ...request, toolName: 'mcp__skills__read_mcp_skill_file' })
    )
    const reading = runtime.getResource({ serverId: other.id, uri: fixture.uri, interactionContext: { sessionId } })
    const rejected = expect(reading).rejects.toThrow()
    const published: unknown[] = []
    vi.spyOn(application, 'isReady').mockReturnValue(true)
    vi.spyOn(application.get('WindowManager'), 'broadcast').mockImplementation((channel) => {
      if (channel === IpcChannel.DataApi_DataChanged)
        published.push(agentSessionMessageService.listApprovalMessages(sessionId).map((message) => message.data.parts))
    })
    await vi.waitFor(() => expect(agentSessionMessageService.listApprovalMessages(sessionId)).toHaveLength(1))
    mcpServerService.update(other.id, { baseUrl: 'http://127.0.0.1:4/mcp' })
    await rejected
    expect(toolApprovalRegistry.hasSession(sessionId)).toBe(false)
    expect(published).toContainEqual([
      [expect.objectContaining({ state: 'approval-responded', approval: expect.objectContaining({ approved: false }) })]
    ])
    expect(agentSessionMessageService.listApprovalMessages(sessionId)[0].data.parts).toMatchObject([
      { state: 'approval-responded', approval: { approved: false } }
    ])
  })

  it('can load directly by URI without listing or an independent interaction host', async () => {
    interactive = false
    expect((await skills.load(sessionId, serverId, fixture.uri)).content.text).toContain('Read references/facts.txt')
    expect(fixture.requests).not.toContain('list')
  })

  function authorizer(
    approved: boolean,
    onRequest?: (approvalId: string) => void,
    mode: 'default' | 'auto' | 'bypassPermissions' = 'default'
  ) {
    const approval: PiApprovalContext = {
      sessionId,
      workspacePath: '/tmp',
      agentDataPath: '/tmp/agent',
      additionalReadOnlyRoots: [],
      getPermissionMode: () => mode,
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
      isDisabled: () => false,
      autoApprovedTools: new Set(
        listBuiltinToolPolicies({ approval: 'auto' }).map(({ serverName, toolName }) =>
          buildPiMcpToolName(serverName, toolName)
        )
      ),
      approvalRequiredTools: new Set(),
      nonBypassableApprovalTools: new Set(),
      delegationTools: new Set(
        listBuiltinToolPolicies({ approval: 'delegation' }).map(({ serverName, toolName }) =>
          buildPiMcpToolName(serverName, toolName)
        )
      )
    }
    return async (event: { toolName: string; toolCallId: string; input: Record<string, unknown> }) => {
      let gate!: GateHandlers
      const host = createScriptedHost({
        settings: {
          permissionMode: mode,
          attendance: 'stream',
          goalDefaults: { maxGoalRounds: 1, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
          autonomy: 'auto',
          maxBackground: 4,
          offloadThreshold: 20000
        }
      })
      const interactions = await createPiInteractionPorts({
        input: { sessionId, agentId, modelId: 'test::model' },
        approval,
        toolCallId: async () => event.toolCallId,
        emit: (event) => {
          if (event.type !== 'tool-approval-request') return
          if (onRequest) onRequest(event.request.approvalId)
          else toolApprovalRegistry.dispatch(event.request.approvalId, { approved })
        }
      })
      const fake = createFakeHarness({
        install: (ports) =>
          install(
            {
              ...ports,
              lifecycle: { register: () => {} },
              toolGate: {
                register: (handlers) => {
                  gate = handlers
                }
              }
            },
            { ...host, ...interactions }
          )
      })
      const thread = await fake.createThread()
      const result = await fake.withCall(thread, (ports) =>
        gate.before(
          {
            thread,
            key: callKeyOf(event.toolCallId),
            tool: event.toolName,
            args: z.json().parse(event.input),
            nested: false,
            signal: new AbortController().signal
          },
          { goalRound: false, callWindow: [], plan: undefined },
          ports
        )
      )
      if (result.block) return { block: true, reason: result.block }
      if (result.args && typeof result.args === 'object') Object.assign(event.input, result.args)
      return undefined
    }
  }

  it('requires per-call code execution approval in both runtimes in default mode', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const claude = await evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, {
      sessionId,
      toolName: 'Bash',
      input: { command: 'echo bypass' },
      permissionMode: 'default',
      builtinRole: undefined,
      mountedServers: new Set(['skills']),
      pluginDirectories: new Map(),
      cwd: '/tmp',
      agentDataPath: '/tmp/agent',
      interaction: { currentTurn: 'interactive', userResponse: 'stream' },
      isDisabled: () => false
    })
    expect(claude).toMatchObject({ effect: 'ask', ruleId: 'mcp-skill-tool-approval' })
    const call = { toolName: 'bash', toolCallId: 'execute', input: { command: 'echo bypass' } }
    expect(await authorizer(true)(call)).toBeUndefined()
    expect(await authorizer(false)({ ...call, toolCallId: 'execute-again' })).toMatchObject({ block: true })
    expect(skills.toolApproval(sessionId, 'read', {})).toBeUndefined()
    expect(skills.toolApproval(sessionId, 'mcp__example__lookup', {})).toBeUndefined()
  })

  it.each(['subagent', 'message_subagent'])(
    'gates native Pi %s after loading remote instructions',
    async (toolName) => {
      const call = { toolName, toolCallId: 'native-delegation', input: { prompt: 'Run a command' } }
      await expect(authorizer(false, undefined, 'auto')(call)).resolves.toBeUndefined()
      await skills.load(sessionId, serverId, fixture.uri)
      await expect(authorizer(false, undefined, 'auto')(call)).resolves.toMatchObject({ block: true })
      await expect(authorizer(true, undefined, 'auto')(call)).resolves.toBeUndefined()
      await expect(
        authorizer(
          false,
          () => {
            throw new Error('Unexpected approval')
          },
          'bypassPermissions'
        )(call)
      ).resolves.toBeUndefined()
    }
  )

  describe.each([
    {
      name: 'session_create',
      input: { message: 'Run echo delegated', target_agent_id: 'destination-agent', title: 'Delegated work' }
    },
    { name: 'session_send', input: { message: 'Run echo delegated', target_session_id: 'destination-session' } },
    { name: 'cron', input: { action: 'add', name: 'Scheduled work', message: 'Run echo scheduled', every: '1h' } },
    { name: 'cron', input: { action: 'update', id: 'scheduled-task', message: 'Run echo replacement' } },
    { name: 'cron', input: { action: 'update', id: 'scheduled-task', every: '1m' } }
  ])('remote-skill execution through $name with $input', ({ name, input }) => {
    const toolName = `mcp__cherry-tools__${name}`

    it('requires Claude approval in Auto only after a remote skill is loaded', async () => {
      const context = {
        sessionId,
        toolName,
        input,
        permissionMode: 'auto' as const,
        builtinRole: undefined,
        mountedServers: new Set(['skills', 'cherry-tools']),
        pluginDirectories: new Map<string, string>(),
        cwd: '/tmp',
        agentDataPath: '/tmp/agent',
        interaction: { currentTurn: 'interactive' as const, userResponse: 'stream' as const },
        isDisabled: () => false
      }
      await expect(evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, context)).resolves.toBeUndefined()
      await skills.load(sessionId, serverId, fixture.uri)
      await expect(evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, context)).resolves.toMatchObject({ effect: 'ask' })
      await expect(
        evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, { ...context, permissionMode: 'bypassPermissions' })
      ).resolves.toBeUndefined()
    })

    it('requires a fresh Pi decision for each Auto call while Full Access does not prompt', async () => {
      const call = { toolName: buildPiMcpToolName('cherry-tools', name), toolCallId: 'execution', input }
      const unexpectedApproval = () => {
        throw new Error('This call must not request approval')
      }
      await expect(authorizer(false, unexpectedApproval, 'auto')(call)).resolves.toBeUndefined()
      await skills.load(sessionId, serverId, fixture.uri)
      await expect(authorizer(true, undefined, 'auto')(call)).resolves.toBeUndefined()
      await expect(
        authorizer(false, undefined, 'auto')({ ...call, toolCallId: 'execution-again' })
      ).resolves.toMatchObject({ block: true })
      await expect(authorizer(false, unexpectedApproval, 'bypassPermissions')(call)).resolves.toBeUndefined()
    })
  })

  it.each(['list', 'remove'])('does not add skill approval to cron %s', async (action) => {
    await skills.load(sessionId, serverId, fixture.uri)
    const input = { action, id: 'scheduled-task' }
    await expect(
      evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, {
        sessionId,
        toolName: 'mcp__cherry-tools__cron',
        input,
        permissionMode: 'default',
        builtinRole: undefined,
        mountedServers: new Set(['cherry-tools']),
        pluginDirectories: new Map(),
        cwd: '/tmp',
        agentDataPath: '/tmp/agent',
        interaction: { currentTurn: 'interactive', userResponse: 'stream' },
        isDisabled: () => false
      })
    ).resolves.toBeUndefined()
    await expect(
      authorizer(false, () => {
        throw new Error('Listing or removing a task must not request skill execution approval')
      })({ toolName: buildPiMcpToolName('cherry-tools', 'cron'), toolCallId: 'manage-task', input })
    ).resolves.toBeUndefined()
  })

  it('passes execution and nested activation without approval in Full Access', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const pi = authorizer(
      false,
      () => {
        throw new Error('Full Access must not request approval')
      },
      'bypassPermissions'
    )
    await expect(
      pi({ toolName: 'bash', toolCallId: 'full-exec', input: { command: 'echo ready' } })
    ).resolves.toBeUndefined()
    await expect(
      pi({
        toolName: 'mcp__skills__load_mcp_skill',
        toolCallId: 'full-nested',
        input: {
          server_id: serverId,
          skill_uri: 'skill://reports/child/SKILL.md'
        }
      })
    ).resolves.toBeUndefined()
    const claude = await evaluateToolGuards(CLAUDE_TOOL_GUARD_RULES, {
      sessionId,
      toolName: 'Bash',
      input: { command: 'echo ready' },
      permissionMode: 'bypassPermissions',
      builtinRole: undefined,
      mountedServers: new Set(['skills']),
      pluginDirectories: new Map(),
      cwd: '/tmp',
      agentDataPath: '/tmp/agent',
      interaction: { currentTurn: 'headless', userResponse: 'unavailable' },
      isDisabled: () => false
    })
    expect(claude).toBeUndefined()
  })

  it('cancels pending execution approval when the origin changes', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const result = await authorizer(true, (approvalId) => {
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
      toolApprovalRegistry.dispatch(approvalId, { approved: true })
    })({ toolName: 'bash', toolCallId: 'execute', input: { command: 'echo bypass' } })
    expect(result).toMatchObject({ block: true })
  })

  describe.each([
    { server: 'mcp-manager', name: 'install_mcp_server', input: { name: 'reports', command: 'node' } },
    { server: 'cherry-tools', name: 'cli_install', input: { name: 'jq', tool: 'jq' } }
  ])('remote-skill installer approval for $name', ({ server, name, input }) => {
    const piName = buildPiMcpToolName(server, name)

    it.each([piName, `mcp__${server}__${name}`])(
      'cancels pending %s approval when another session discovers a replacement',
      async (toolName) => {
        await skills.load(sessionId, serverId, fixture.uri)
        const requested = Promise.withResolvers<string>()
        const result = authorizer(true, requested.resolve)({ toolName, toolCallId: 'install', input: { ...input } })
        const approvalId = await requested.promise

        skills.openSession('other-session', agentId)
        fixture.files.set('skill://reports/references/facts.txt', 'replacement')
        fixture.refresh()
        await skills.get('other-session', serverId, fixture.uri)

        const dispatched = toolApprovalRegistry.dispatch(approvalId, { approved: true })
        await expect(result).resolves.toMatchObject({ block: true })
        expect(dispatched).toBeUndefined()
        expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
      }
    )

    it('allows the pending Pi call after unchanged discovery and approval', async () => {
      await skills.load(sessionId, serverId, fixture.uri)
      const requested = Promise.withResolvers<string>()
      const result = authorizer(
        true,
        requested.resolve
      )({
        toolName: piName,
        toolCallId: 'install',
        input: { ...input }
      })
      const approvalId = await requested.promise

      skills.openSession('other-session', agentId)
      await skills.get('other-session', serverId, fixture.uri)

      expect(toolApprovalRegistry.dispatch(approvalId, { approved: true })).toBeDefined()
      await expect(result).resolves.toBeUndefined()
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)
    })

    it('passes the Pi call without approval in Full Access', async () => {
      await skills.load(sessionId, serverId, fixture.uri)
      await expect(
        authorizer(
          false,
          () => {
            throw new Error('Full Access must not request approval')
          },
          'bypassPermissions'
        )({ toolName: piName, toolCallId: 'install', input: { ...input } })
      ).resolves.toBeUndefined()
    })
  })

  it('restores provenance without prompting on resume and detects changed manifests', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    skills.closeSession(sessionId)
    skills.openSession(sessionId, agentId)
    await expect(
      authorizer(
        true,
        undefined,
        'bypassPermissions'
      )({
        toolName: 'bash',
        toolCallId: 'valid-restore',
        input: { command: 'echo restored' }
      })
    ).resolves.toBeUndefined()
    expect(
      await authorizer(false)({
        toolName: 'bash',
        toolCallId: 'restored-execution',
        input: { command: 'echo restored' }
      })
    ).toMatchObject({ block: true })
    fixture.files.set('skill://reports/references/facts.txt', 'replacement')
    fixture.refresh()
    await skills.get(sessionId, serverId, fixture.uri)
    await expect(skills.read(sessionId, serverId, fixture.uri, fixture.uri)).rejects.toThrow()
  })

  it.each(['digest', 'manifest'] as const)('retains %s invalidation after session teardown', async (failure) => {
    await skills.load(sessionId, serverId, fixture.uri)
    fixture.files.set('skill://reports/references/facts.txt', 'replacement')
    if (failure === 'manifest') {
      fixture.refresh()
      await skills.get(sessionId, serverId, fixture.uri)
    } else {
      await expect(
        skills.read(sessionId, serverId, fixture.uri, 'skill://reports/references/facts.txt')
      ).rejects.toThrow()
    }
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
    skills.closeSession(sessionId)
    skills.openSession(sessionId, agentId)
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
    await expect(
      authorizer(
        true,
        undefined,
        'bypassPermissions'
      )({
        toolName: 'bash',
        toolCallId: 'restored',
        input: { command: 'echo stale' }
      })
    ).resolves.toMatchObject({ block: true })
    await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
  })

  it.each([{ baseUrl: 'http://127.0.0.1:2/mcp' }, { headers: { Authorization: 'replacement-secret' } }])(
    'rejects an origin changed while the session is closed: %j',
    async (change) => {
      await skills.load(sessionId, serverId, fixture.uri)
      skills.closeSession(sessionId)
      mcpServerService.update(serverId, change)
      skills.openSession(sessionId, agentId)
      expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
      await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
    }
  )

  it.each(
    (['disable', 'configuration', 'deselect'] as const).flatMap((event) =>
      [false, true].map((closed) => ({ event, closed }))
    )
  )('retains $event invalidation after restoration with closed=$closed', async ({ event, closed }) => {
    await skills.load(sessionId, serverId, fixture.uri)
    const approval = skills.toolApproval(sessionId, 'Bash', {}, 'default')!
    if (closed) skills.closeSession(sessionId)

    if (event === 'disable') {
      mcpServerService.update(serverId, { isActive: false })
      mcpServerService.update(serverId, { isActive: true })
    } else if (event === 'configuration') {
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:1/mcp' })
    } else {
      agentService.updateAgent(agentId, { mcps: [] })
      agentService.updateAgent(agentId, { mcps: [serverId] })
    }

    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.approve()).toThrow()
    if (!closed) skills.closeSession(sessionId)
    skills.openSession(sessionId, agentId)
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
    await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
  })

  it('preserves closed skill context for unchanged selection, metadata edits and unrelated origins or agents', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    skills.closeSession(sessionId)
    mcpServerService.update(serverId, { name: 'Renamed origin' })
    agentService.updateAgent(agentId, { mcps: [serverId] })
    const other = mcpServerService.create({
      name: 'Unrelated origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:3/mcp',
      isActive: true
    })
    mcpServerService.update(other.id, { isActive: false })
    dbh.db
      .insert(agentTable)
      .values({ id: 'other-agent', type: 'pi', name: 'Other', instructions: '', orderKey: 'a1' })
      .run()
    agentService.updateAgent('other-agent', { mcps: [] })

    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)
    skills.openSession(sessionId, agentId)
    await expect(skills.load(sessionId, serverId, fixture.uri)).resolves.toMatchObject({ entry: { serverId } })
  })

  it('persists explicit server stop invalidation for a closed runtime', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    skills.closeSession(sessionId)
    await runtime.stopServer(serverId)
    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
    skills.openSession(sessionId, agentId)
    await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
  })

  it('keeps invalidation across service restart and stores only an opaque origin fingerprint', async () => {
    const secret = 'private-auth-header'
    mcpServerService.update(serverId, { headers: { Authorization: secret } })
    const loaded = await skills.load(sessionId, serverId, fixture.uri)
    const context = agentSessionMessageService.listMcpSkills(sessionId)[0]
    expect(context).toMatchObject({ originFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/), invalidated: false })
    expect(JSON.stringify(context)).not.toContain(secret)
    expect(loaded.entry).not.toHaveProperty('originFingerprint')
    fixture.files.set('skill://reports/references/facts.txt', 'tampered')
    await expect(
      skills.read(sessionId, serverId, fixture.uri, 'skill://reports/references/facts.txt')
    ).rejects.toThrow()
    await skills._doStop()
    BaseService.resetInstances()
    skills = new McpSkillService()
    await skills._doInit()
    skills.openSession(sessionId, agentId)
    await expect(
      authorizer(
        true,
        undefined,
        'bypassPermissions'
      )({
        toolName: 'bash',
        toolCallId: 'service-restart',
        input: { command: 'echo stale' }
      })
    ).resolves.toMatchObject({ block: true })
    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
  })

  it.each(
    ['metadata', 'file'].flatMap((stage) => [
      { stage, source: 'picker', replacement: true },
      { stage, source: 'session', replacement: true },
      { stage, source: 'get', replacement: true },
      { stage, source: 'other-session', replacement: true },
      { stage, source: 'picker', replacement: false }
    ])
  )(
    'handles $source discovery during an initial load at the $stage stage (replacement: $replacement)',
    async ({ stage, source, replacement }) => {
      const reading = Promise.withResolvers<void>()
      const release = Promise.withResolvers<void>()
      const originalText = String(fixture.files.get(fixture.uri))
      const createServer = fixture.createServer.bind(fixture)
      vi.spyOn(fixture, 'createServer').mockImplementation(() => {
        const server = createServer()
        if (stage === 'metadata') {
          const handle = server.fallbackRequestHandler!
          let firstGet = true
          server.fallbackRequestHandler = async (request, context) => {
            const result = await handle(request, context)
            if (request.method === 'skills/get' && firstGet) {
              firstGet = false
              reading.resolve()
              await release.promise
            }
            return result
          }
        }
        server.setRequestHandler('resources/read', async ({ params }) => {
          if (stage === 'file') {
            reading.resolve()
            await release.promise
          }
          return { contents: [{ uri: params.uri, text: originalText }], ttlMs: 0, cacheScope: 'private' }
        })
        return server
      })
      const input = { server_id: serverId, skill_uri: fixture.uri }
      const approval = skills.toolApproval(sessionId, 'mcp__skills__load_mcp_skill', input, 'default')!
      const pending = skills
        .loadFromTool(sessionId, { ...input, ...approval.approve() }, new AbortController().signal)
        .then(
          (value) => ({ value, rejected: false }),
          () => ({ value: undefined, rejected: true })
        )
      try {
        await reading.promise
        if (replacement) {
          fixture.files.set(fixture.uri, `${originalText}Replacement instructions.\n`)
          fixture.refresh()
        }
        if (source === 'picker') await application.get('McpCatalogService').listSkills(serverId)
        else if (source === 'session') await skills.list(sessionId)
        else if (source === 'other-session') {
          skills.openSession('other-session', agentId)
          await skills.get('other-session', serverId, fixture.uri)
        } else await skills.get(sessionId, serverId, fixture.uri)
      } finally {
        release.resolve()
      }
      const result = await pending
      expect(result.rejected).toBe(replacement)
      if (replacement) {
        expect(result.value).toBeUndefined()
        expect(agentSessionMessageService.listMcpSkills(sessionId)).toEqual([])
      } else {
        expect(result.value?.content.text).toBe(originalText)
        expect(agentSessionMessageService.listMcpSkills(sessionId)).toMatchObject([{ invalidated: false }])
      }
    }
  )

  it.each(['picker', 'get'])(
    'persists %s replacement invalidation for a closed runtime across service restart',
    async (source) => {
      await skills.load(sessionId, serverId, fixture.uri)
      const original = fixture.manifest()
      skills.closeSession(sessionId)
      skills.openSession('other-session', agentId)
      const discover = () =>
        source === 'picker'
          ? application.get('McpCatalogService').listSkills(serverId)
          : skills.get('other-session', serverId, fixture.uri)
      await discover()
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)

      fixture.files.set('skill://reports/references/facts.txt', 'replacement')
      fixture.refresh()
      const other = mcpServerService.create({
        name: 'Unrelated origin',
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:3/mcp',
        isActive: true
      })
      await application.get('McpCatalogService').listSkills(other.id)
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)
      await discover()
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)

      fixture.publish(original)
      await discover()
      await skills._doStop()
      BaseService.resetInstances()
      skills = new McpSkillService()
      await skills._doInit()
      skills.openSession(sessionId, agentId)
      expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
      await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
    }
  )

  it('invalidates another session when direct lookup discovers a replacement', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const approval = skills.toolApproval(sessionId, 'Bash', {}, 'default')!
    skills.openSession('other-session', agentId)
    await skills.get('other-session', serverId, fixture.uri)
    expect(approval.signal.aborted).toBe(false)

    fixture.files.set('skill://reports/references/facts.txt', 'replacement')
    fixture.refresh()
    await skills.get('other-session', serverId, fixture.uri)

    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.approve()).toThrow()
    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
  })

  it.each(['picker', 'session'] as const)(
    'invalidates persisted skills and pending execution approval on %s catalog replacement',
    async (source) => {
      await skills.load(sessionId, serverId, fixture.uri)
      const approval = skills.toolApproval(sessionId, 'Bash', { command: 'echo report' }, 'default')!
      const discover = () =>
        source === 'picker' ? application.get('McpCatalogService').listSkills(serverId) : skills.list(sessionId)

      await discover()
      expect(approval.signal.aborted).toBe(false)
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)

      fixture.files.set('skill://reports/references/facts.txt', 'replacement')
      fixture.refresh()
      const other = mcpServerService.create({
        name: 'Unrelated origin',
        type: 'streamableHttp',
        baseUrl: 'http://127.0.0.1:3/mcp',
        isActive: true
      })
      await application.get('McpCatalogService').listSkills(other.id)
      expect(approval.signal.aborted).toBe(false)
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(false)
      await discover()

      expect(approval.signal.aborted).toBe(true)
      expect(() => approval.approve()).toThrow()
      expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
      expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
      skills.closeSession(sessionId)
      skills.openSession(sessionId, agentId)
      expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
      await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow()
    }
  )

  it('rejects initial-load approval after its origin changes without any protocol lookup', () => {
    const approval = skills.toolApproval(sessionId, 'mcp__skills__load_mcp_skill', {
      server_id: serverId,
      skill_uri: fixture.uri
    })!
    mcpServerService.update(serverId, { headers: { Authorization: 'new-auth' } })
    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.approve()).toThrow()
    expect(fixture.requests).toEqual([])
  })

  it('cancels the first load approval when its target changes and requires a fresh decision', async () => {
    const call = {
      toolName: 'mcp__skills__load_mcp_skill',
      toolCallId: 'initial-load',
      input: { server_id: serverId, skill_uri: fixture.uri }
    }
    const decision = await authorizer(true, (approvalId) => {
      mcpServerService.update(serverId, { baseUrl: 'http://127.0.0.1:2/mcp' })
      toolApprovalRegistry.dispatch(approvalId, { approved: true })
    })(call)
    expect(decision).toMatchObject({ block: true })
    expect(fixture.requests).toEqual([])
    expect(await authorizer(true)({ ...call, toolCallId: 'fresh-load' })).toBeUndefined()
    expect((await skills.load(sessionId, serverId, fixture.uri)).content.text).toContain('Read references/facts.txt')
  })

  it('rejects tampering and unlisted reads through the generic resource path', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    fixture.files.set('skill://reports/references/facts.txt', 'changed without a new manifest')
    await expect(
      runtime.getResource({ serverId, uri: 'skill://reports/references/facts.txt', interactionContext: { sessionId } })
    ).rejects.toThrow('verification')
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
  })

  it('rejects out-of-manifest files before the generic resource request reaches the server', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    await expect(
      runtime.getResource({ serverId, uri: 'skill://reports/secret', interactionContext: { sessionId } })
    ).rejects.toThrow('manifest')
    expect(fixture.requests).not.toContain('read:skill://reports/secret')
  })

  it('keeps identical URIs on different servers separate and requires per-call cross-origin tool approval', async () => {
    const other = mcpServerService.create({
      name: 'Other origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:3/mcp',
      isActive: true
    })
    dbh.db.insert(agentMcpServerTable).values({ agentId, mcpServerId: other.id }).run()
    const entries = (await skills.list(sessionId)).flatMap((catalog) => catalog.skills)
    expect(new Set(entries.map((entry) => entry.serverId))).toEqual(new Set([serverId, other.id]))
    await skills.load(sessionId, serverId, fixture.uri)
    const before = fixture.requests.filter((request) => request.startsWith('read:')).length
    decide.mockResolvedValue({ approved: false })
    await expect(
      runtime.getResource({ serverId: other.id, uri: fixture.uri, interactionContext: { sessionId } })
    ).rejects.toThrow()
    expect(fixture.requests.filter((request) => request.startsWith('read:'))).toHaveLength(before)
    decide.mockResolvedValue({ approved: true })
    await skills.load(sessionId, other.id, fixture.uri)
    expect(agentSessionMessageService.listMcpSkills(sessionId).map((entry) => entry.serverId)).toEqual([
      serverId,
      other.id
    ])
    decide.mockResolvedValue({ approved: false })
    await expect(
      runtime.getResource({ serverId: other.id, uri: fixture.uri, interactionContext: { sessionId } })
    ).rejects.toThrow()
  })

  it('cancels cross-origin tool approval if the target changes before a resource read', async () => {
    const other = mcpServerService.create({
      name: 'Other origin',
      type: 'streamableHttp',
      baseUrl: 'http://127.0.0.1:3/mcp',
      isActive: true
    })
    dbh.db.insert(agentMcpServerTable).values({ agentId, mcpServerId: other.id }).run()
    await skills.load(sessionId, serverId, fixture.uri)
    const before = fixture.requests.filter((request) => request.startsWith('read:'))
    let ready!: () => void
    const waiting = new Promise<void>((resolve) => {
      ready = resolve
    })
    decide.mockImplementation(
      (_sessionId, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          ready()
        })
    )
    const pending = runtime.getResource({ serverId: other.id, uri: fixture.uri, interactionContext: { sessionId } })
    const rejected = expect(pending).rejects.toThrow()
    await waiting
    mcpServerService.update(other.id, { baseUrl: 'http://127.0.0.1:4/mcp' })
    await rejected
    expect(fixture.requests.filter((request) => request.startsWith('read:'))).toEqual(before)
  })

  it('requires separate activation for a nested skill and declines dynamic manifests', async () => {
    const uri = 'skill://reports/reports/SKILL.md'
    fixture.files.set(uri, fixture.files.get(fixture.uri)!)
    fixture.refresh()
    const entry = fixture.manifest()
    fixture.publish({ ...entry, uri, resources: entry.resources.filter((file) => file.uri === uri) })
    await skills.load(sessionId, serverId, fixture.uri)
    expect((await skills.read(sessionId, serverId, fixture.uri, uri)).text).toContain('name: reports')
    expect(agentSessionMessageService.listMcpSkills(sessionId)).toHaveLength(1)
    const input = { server_id: serverId, skill_uri: uri }
    expect(
      await authorizer(false)({ toolName: 'mcp__skills__load_mcp_skill', toolCallId: 'nested', input })
    ).toMatchObject({ block: true })
    expect(agentSessionMessageService.listMcpSkills(sessionId)).toHaveLength(1)
    fixture.publish({ ...entry, uri: 'skill://dynamic/reports/SKILL.md', resources: 'dynamic' })
    await expect(skills.load(sessionId, serverId, 'skill://dynamic/reports/SKILL.md')).rejects.toThrow()
  })

  it('invalidates loaded skills and cancels approvals after the runtime service restarts', async () => {
    await skills._doStop()
    await runtime._doStop()
    await runtime._doInit()
    await skills._doInit()
    skills.openSession(sessionId, agentId)
    await skills.load(sessionId, serverId, fixture.uri)
    const approval = skills.toolApproval(sessionId, 'Bash', {}, 'default')!

    await runtime.stopServer(serverId)

    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.approve()).toThrow()
    expect(agentSessionMessageService.listMcpSkills(sessionId)[0].invalidated).toBe(true)
    expect(skills.guardTool(sessionId, 'Bash')).toBeTruthy()
  })

  it('rejects calls after session closure', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const approval = skills.toolApproval(sessionId, 'Bash', {})!
    skills.closeSession(sessionId)
    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.approve()).toThrow()
    await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow('not active')
  })
})
