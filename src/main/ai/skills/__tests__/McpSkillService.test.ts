import { InMemoryTransport } from '@modelcontextprotocol/client'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { setupTestDatabase } from '@test-helpers/db'
import { connectMcpTestClient } from '@test-helpers/mcp/client'
import { createMcpSkillsFixture } from '@test-helpers/mcpSkills'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
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
import { createPiToolAuthorizer } from '@main/ai/runtime/pi/approvalExtension'
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
      .values({ id: sessionId, name: 'Skills', agentId, workspaceId: 'workspace', orderKey: 'a0' })
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

  it('exposes discover, load and read as separate tools with origin and content', async () => {
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
    } finally {
      await client.close()
    }
  })

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
    mode: 'default' | 'bypassPermissions' = 'default'
  ) {
    return createPiToolAuthorizer({
      sessionId,
      workspacePath: '/tmp',
      agentDataPath: '/tmp/agent',
      additionalReadOnlyRoots: [],
      emit: (event) => {
        if (event.type !== 'tool-approval-request') return
        if (onRequest) onRequest(event.request.approvalId)
        else toolApprovalRegistry.dispatch(event.request.approvalId, { approved })
      },
      getPermissionMode: () => mode,
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' }),
      isDisabled: () => false,
      autoApprovedTools: new Set(),
      approvalRequiredTools: new Set(),
      nonBypassableApprovalTools: new Set(),
      delegationTools: new Set()
    })
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

  it('invalidates the initial-load validation handle before any protocol lookup', () => {
    const approval = skills.toolApproval(sessionId, 'mcp__skills__load_mcp_skill', {
      server_id: serverId,
      skill_uri: fixture.uri
    })!
    mcpServerService.update(serverId, { headers: { Authorization: 'new-auth' } })
    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.validate()).toThrow()
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

  it('rejects calls after session closure', async () => {
    await skills.load(sessionId, serverId, fixture.uri)
    const approval = skills.toolApproval(sessionId, 'Bash', {})!
    skills.closeSession(sessionId)
    expect(approval.signal.aborted).toBe(true)
    expect(() => approval.validate()).toThrow()
    await expect(skills.load(sessionId, serverId, fixture.uri)).rejects.toThrow('not active')
  })
})
