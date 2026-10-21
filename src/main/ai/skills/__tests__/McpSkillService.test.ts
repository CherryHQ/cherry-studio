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
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { mcpServerService } from '@data/services/McpServerService'
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
      (
        sessionId: string,
        request: { signal: AbortSignal; reason: string; input: Record<string, unknown> }
      ) => Promise<DispatchDecision>
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
      const load = await client.callTool({
        name: 'load_mcp_skill',
        arguments: { server_id: serverId, skill_uri: fixture.uri }
      })
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
