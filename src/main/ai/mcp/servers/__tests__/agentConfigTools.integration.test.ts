import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { McpServer } from '@modelcontextprotocol/server'
import { setupTestDatabase } from '@test-helpers/db'
import { MockApplicationUtils } from '@test-mocks/main/application'
import { MockMainPreferenceServiceUtils } from '@test-mocks/main/PreferenceService'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { application } from '@application'
import { agentGlobalSkillTable } from '@data/db/schemas/agentGlobalSkill'
import { knowledgeBaseTable } from '@data/db/schemas/knowledge'
import { mcpServerTable } from '@data/db/schemas/mcpServer'
import { userModelTable } from '@data/db/schemas/userModel'
import { userProviderTable } from '@data/db/schemas/userProvider'
import { agentGlobalSkillService } from '@data/services/AgentGlobalSkillService'
import { agentService } from '@data/services/AgentService'
import { agentSessionService } from '@data/services/AgentSessionService'
import { agentWorkspaceService } from '@data/services/AgentWorkspaceService'
import { previewAgentConfigUpdate } from '@main/ai/agents/agentConfigTool'
import { resolveAgentCapabilities } from '@main/ai/agents/builtin/builtinAgentCapabilities'
import { BUILTIN_AGENT_ROLE, CHERRY_SUPPORT_AGENT_ID } from '@shared/ai/builtinAgent'
import type { AgentEntity } from '@shared/data/api/schemas/agents'
import { ENDPOINT_TYPE, MODEL_CAPABILITY } from '@shared/data/types/model'

import { createAssistantServer } from '../assistant'
import { type AutonomyToolsContext, registerAutonomyTools } from '../cherryAutonomyTools'
import { callBuiltinTool, listBuiltinTools, toolText } from './builtinMcpClient'

const DEFAULT_MODEL = 'wire::default-model'
const OTHER_MODEL = 'wire::other-model'
const USER_SKILL = 'user-skill'
const BUILTIN_SKILL = 'builtin-skill'
const KNOWLEDGE_BASE = '6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b'

describe('Agent create and configure tools', () => {
  const dbh = setupTestDatabase()
  let agentsDataDir: string

  const assistantServer = () => createAssistantServer(DEFAULT_MODEL)

  function cherryToolsServer(agentId: string, sessionId = 'session-unused') {
    const context: AutonomyToolsContext = {
      agentId,
      sessionId,
      workspaceSource: { type: 'system' },
      workspacePath: agentsDataDir,
      trustedNotifyChannels: [],
      allowAnyOwnedNotifyChannel: false,
      agentCreateEnabled: resolveAgentCapabilities(agentService.getAgent(agentId)).createAgents
    }
    return () => {
      const server = new McpServer({ name: 'cherry-tools', version: '1.0.0' })
      registerAutonomyTools(server, context)
      return server
    }
  }

  function seedAgent(id: string, overrides: Partial<Parameters<typeof agentService.createAgentWithId>[1]> = {}) {
    return agentService.createAgentWithId(id, {
      type: 'pi-durable',
      name: `Agent ${id}`,
      description: 'Original description',
      instructions: 'Original instructions',
      model: DEFAULT_MODEL,
      mcps: ['mcp-1'],
      configuration: { avatar: '🦊', permission_mode: 'default', env_vars: { TOKEN: 'secret' } },
      ...overrides
    })
  }

  /** Built-in roles are reserved on create, so a test seeds one by writing the role afterwards. */
  function seedBuiltinAgent(role: (typeof BUILTIN_AGENT_ROLE)[keyof typeof BUILTIN_AGENT_ROLE]) {
    // Main only trusts the Support role on its reserved ID.
    const id = role === BUILTIN_AGENT_ROLE.SUPPORT ? CHERRY_SUPPORT_AGENT_ID : `builtin-${role}`
    const agent = seedAgent(id)
    application
      .get('DbService')
      .withWriteTx((tx) =>
        agentService.updateAgentTx(tx, id, { configuration: { ...agent.configuration, builtin_role: role } })
      )
    return id
  }

  function createSession(agentId: string) {
    const workspace = agentWorkspaceService.findOrCreateByPath(agentsDataDir)
    return agentSessionService.create({
      agentId,
      name: 'Session',
      workspace: { type: 'user', workspaceId: workspace.id }
    })
  }

  function skillEnabledFor(agentId: string, skillId: string): boolean {
    return agentGlobalSkillService.list({ agentId }).find((skill) => skill.id === skillId)?.isEnabled ?? false
  }

  function liveAgents(): AgentEntity[] {
    return agentService.listAgents().agents
  }

  beforeEach(() => {
    agentsDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cherry-agent-config-tools-'))
    const getPath = vi.mocked(application.getPath).getMockImplementation()!
    vi.spyOn(application, 'getPath').mockImplementation((key, file) => {
      if (key === 'feature.agents.data') return path.join(agentsDataDir, file ?? '')
      if (key === 'feature.provider_registry.data') return path.resolve('packages/provider-registry/data', file ?? '')
      return getPath(key, file)
    })
    MockApplicationUtils.setService('AgentJobsService', { waitForHeartbeat: vi.fn(async () => undefined) })
    MockApplicationUtils.setService('AgentSessionRuntimeService', {
      getInteractionState: () => ({ currentTurn: 'interactive', userResponse: 'stream' })
    })
    MockMainPreferenceServiceUtils.setPreferenceValue('app.language', 'en-US')
    MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', DEFAULT_MODEL)

    dbh.db
      .insert(userProviderTable)
      .values({
        providerId: 'wire',
        name: 'Wire provider',
        isEnabled: true,
        orderKey: 'a0',
        endpointConfigs: { [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]: { baseUrl: 'https://openai.test/v1' } },
        defaultChatEndpoint: ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS
      })
      .run()
    dbh.db
      .insert(userModelTable)
      .values(
        [
          ['default-model', 'Default Model'],
          ['other-model', 'Other Model']
        ].map(([modelId, name], index) => ({
          id: `wire::${modelId}`,
          providerId: 'wire',
          modelId,
          name,
          capabilities: [MODEL_CAPABILITY.FUNCTION_CALL],
          supportsStreaming: true,
          isEnabled: true,
          orderKey: `a${index}`,
          endpointTypes: [ENDPOINT_TYPE.OPENAI_CHAT_COMPLETIONS]
        }))
      )
      .run()
    dbh.db
      .insert(agentGlobalSkillTable)
      .values([
        {
          id: USER_SKILL,
          name: 'Code Review',
          folderName: 'code-review',
          source: 'owner/repo',
          contentHash: 'a',
          isEnabled: true
        },
        {
          id: BUILTIN_SKILL,
          name: 'Built-in',
          folderName: 'builtin',
          source: 'builtin',
          contentHash: 'b',
          isEnabled: true
        }
      ])
      .run()
    dbh.db
      .insert(knowledgeBaseTable)
      .values({
        id: KNOWLEDGE_BASE,
        name: 'Handbook',
        orderKey: 'a0',
        status: 'completed',
        chunkSize: 1024,
        chunkOverlap: 200
      })
      .run()
    dbh.db.insert(mcpServerTable).values({ id: 'mcp-1', name: 'Search', isActive: true }).run()
  })

  afterEach(() => {
    MockApplicationUtils.resetServices()
    MockMainPreferenceServiceUtils.resetMocks()
    vi.restoreAllMocks()
    fs.rmSync(agentsDataDir, { recursive: true, force: true })
  })

  describe('create_agent', () => {
    it('creates a Pi Durable Agent that carries every supplied field and shows up in the Agent list', async () => {
      const result = await callBuiltinTool(assistantServer, 'create_agent', {
        name: 'Reviewer',
        emoji: '🧐',
        description: 'Reviews pull requests',
        instructions: 'Review the diff.',
        model: OTHER_MODEL,
        permissionMode: 'acceptEdits',
        skillIds: [USER_SKILL],
        knowledgeBaseIds: [KNOWLEDGE_BASE],
        mcpServerIds: ['mcp-1'],
        disabledTools: ['bash'],
        language: 'English',
        heartbeat: { enabled: true, intervalMinutes: 45, timeoutMinutes: 5 }
      })

      expect(result.isError, toolText(result)).not.toBe(true)
      const output = result.structuredContent as { agentId: string; summary: string[] }
      const agent = agentService.getAgent(output.agentId)!
      expect(agent).toMatchObject({
        type: 'pi-durable',
        name: 'Reviewer',
        description: 'Reviews pull requests',
        instructions: 'Review the diff.',
        model: OTHER_MODEL,
        mcps: ['mcp-1'],
        knowledgeBaseIds: [KNOWLEDGE_BASE],
        disabledTools: ['bash']
      })
      expect(agent.configuration).toMatchObject({
        avatar: '🧐',
        permission_mode: 'acceptEdits',
        language: 'English',
        heartbeat_enabled: true,
        heartbeat_interval: 45,
        heartbeat_timeout_minutes: 5
      })
      expect(skillEnabledFor(agent.id, USER_SKILL)).toBe(true)
      expect(liveAgents().map((entry) => entry.id)).toContain(agent.id)
      expect(result.structuredContent).toMatchObject({ ok: true, name: 'Reviewer', emoji: '🧐' })
      expect(output.summary).toContain('Model: Other Model')
    })

    it('uses the default model when none is given and falls back to ✨ for an invalid emoji', async () => {
      const result = await callBuiltinTool(assistantServer, 'create_agent', {
        name: 'Helper',
        emoji: 'not an emoji',
        instructions: 'Help.'
      })

      expect(result.isError, toolText(result)).not.toBe(true)
      const agent = agentService.getAgent((result.structuredContent as { agentId: string }).agentId)!
      expect(agent.model).toBe(DEFAULT_MODEL)
      expect(agent.configuration?.avatar).toBe('✨')
    })

    it.each([
      ['skill', { skillIds: ['missing-skill'] }, 'Unknown skill ID: missing-skill'],
      ['knowledge base', { knowledgeBaseIds: ['missing-kb'] }, 'Unknown knowledge base ID: missing-kb'],
      ['MCP server', { mcpServerIds: ['missing-mcp'] }, 'Unknown MCP server ID: missing-mcp'],
      ['built-in skill', { skillIds: [BUILTIN_SKILL] }, `Unknown skill ID: ${BUILTIN_SKILL}`]
    ])('rejects an uninstalled %s ID without creating an Agent', async (_kind, fields, message) => {
      const result = await callBuiltinTool(assistantServer, 'create_agent', {
        name: 'Reviewer',
        instructions: 'Review.',
        ...fields
      })

      expect(result.isError).toBe(true)
      expect(toolText(result)).toContain(message)
      expect(liveAgents()).toEqual([])
    })

    it('refuses bypassPermissions', async () => {
      const result = await callBuiltinTool(assistantServer, 'create_agent', {
        name: 'Reviewer',
        instructions: 'Review.',
        permissionMode: 'bypassPermissions'
      })

      expect(result.isError).toBe(true)
      expect(toolText(result)).toContain('bypassPermissions')
      expect(liveAgents()).toEqual([])
    })
  })

  describe('update_agent', () => {
    it('changes only the given fields and reports each one as current → new', async () => {
      seedAgent('target')

      const result = await callBuiltinTool(assistantServer, 'update_agent', {
        agentId: 'target',
        description: 'Sharper description',
        model: OTHER_MODEL
      })

      expect(result.isError, toolText(result)).not.toBe(true)
      expect(agentService.getAgent('target')).toMatchObject({
        description: 'Sharper description',
        model: OTHER_MODEL,
        instructions: 'Original instructions',
        mcps: ['mcp-1'],
        configuration: { avatar: '🦊', permission_mode: 'default', env_vars: { TOKEN: 'secret' } }
      })
      expect((result.structuredContent as { summary: string[] }).summary).toEqual([
        'Description: Original description → Sharper description',
        'Model: Default Model → Other Model'
      ])
    })

    it.each([
      ['bypassPermissions', { permissionMode: 'bypassPermissions' }],
      ['environment variables', { env_vars: { TOKEN: 'leaked' } }]
    ])('refuses %s and leaves the Agent untouched', async (_case, fields) => {
      seedAgent('target')

      const result = await callBuiltinTool(assistantServer, 'update_agent', { agentId: 'target', ...fields })

      expect(result.isError).toBe(true)
      expect(agentService.getAgent('target')?.configuration).toMatchObject({
        permission_mode: 'default',
        env_vars: { TOKEN: 'secret' }
      })
    })

    it.each(Object.values(BUILTIN_AGENT_ROLE))('refuses the built-in %s Agent', async (role) => {
      const id = seedBuiltinAgent(role)

      const result = await callBuiltinTool(assistantServer, 'update_agent', { agentId: id, description: 'Changed' })

      expect(result.isError).toBe(true)
      expect(toolText(result)).toContain('built-in Agent')
      expect(agentService.getAgent(id)?.description).toBe('Original description')
    })

    it('previews the approval summary without writing', () => {
      seedAgent('target')

      expect(previewAgentConfigUpdate({ tool: 'update_agent', input: { agentId: 'target', language: 'off' } })).toEqual(
        { ok: true, summary: ['Reply language: Follow global setting → No constraint'] }
      )
      expect(agentService.getAgent('target')?.configuration).not.toHaveProperty('language')
      expect(
        previewAgentConfigUpdate({
          tool: 'update_agent',
          input: { agentId: 'target', permissionMode: 'bypassPermissions' }
        })
      ).toMatchObject({ ok: false })
    })
  })

  describe('agent_list', () => {
    it('lists live Agents with their identity and marks built-in ones read-only', async () => {
      seedAgent('live')
      seedAgent('trashed')
      agentService.deleteAgent('trashed')
      const assistantId = seedBuiltinAgent(BUILTIN_AGENT_ROLE.ASSISTANT)

      const result = await callBuiltinTool(cherryToolsServer('live', createSession('live').id), 'agent_list')

      const { agents } = JSON.parse(toolText(result)) as { agents: Array<Record<string, unknown>> }
      expect(agents.map((agent) => agent.id).sort()).toEqual([assistantId, 'live'])
      expect(agents.find((agent) => agent.id === 'live')).toMatchObject({
        name: 'Agent live',
        emoji: '🦊',
        description: 'Original description',
        model: DEFAULT_MODEL,
        readOnly: false
      })
      expect(agents.find((agent) => agent.id === assistantId)?.readOnly).toBe(true)
    })
  })

  describe('agent_create (every user-created Agent)', () => {
    it('lets a plain Agent create an Agent that appears in the list, defaulting to the caller model', async () => {
      MockMainPreferenceServiceUtils.setPreferenceValue('chat.default_model_id', null)
      seedAgent('plain', { model: OTHER_MODEL })

      const result = await callBuiltinTool(cherryToolsServer('plain'), 'agent_create', {
        name: 'Note Taker',
        instructions: 'Take notes.'
      })

      expect(result.isError, toolText(result)).not.toBe(true)
      const created = agentService.getAgent((result.structuredContent as { agentId: string }).agentId)!
      expect(created).toMatchObject({ type: 'pi-durable', name: 'Note Taker', model: OTHER_MODEL })
      expect(liveAgents().map((agent) => agent.id)).toContain(created.id)
    })

    it.each(Object.values(BUILTIN_AGENT_ROLE))(
      'is not offered to the built-in %s Agent, which has no cherry-tools create',
      async (role) => {
        const names = (await listBuiltinTools(cherryToolsServer(seedBuiltinAgent(role)))).map((tool) => tool.name)

        expect(names).not.toContain('agent_create')
        expect(names).toContain('config')
      }
    )
  })

  describe('config_update (self)', () => {
    it("changes the calling Agent's own fields", async () => {
      seedAgent('self')

      const result = await callBuiltinTool(cherryToolsServer('self'), 'config_update', {
        instructions: 'New instructions',
        skillIds: [USER_SKILL]
      })

      expect(result.isError, toolText(result)).not.toBe(true)
      expect(agentService.getAgent('self')?.instructions).toBe('New instructions')
      expect(skillEnabledFor('self', USER_SKILL)).toBe(true)
    })

    it('keeps built-in skills enabled when it replaces the skill set', async () => {
      seedAgent('self')
      expect(skillEnabledFor('self', BUILTIN_SKILL)).toBe(true)

      await callBuiltinTool(cherryToolsServer('self'), 'config_update', { skillIds: [USER_SKILL] })

      expect(skillEnabledFor('self', BUILTIN_SKILL)).toBe(true)
    })

    it.each([
      ['bypassPermissions', { permissionMode: 'bypassPermissions' }],
      ['environment variables', { env_vars: { TOKEN: 'leaked' } }],
      ['a rename (approval-free on config)', { name: 'Renamed' }]
    ])('refuses %s', async (_case, fields) => {
      seedAgent('self')

      const result = await callBuiltinTool(cherryToolsServer('self'), 'config_update', fields)

      expect(result.isError).toBe(true)
      expect(agentService.getAgent('self')).toMatchObject({
        name: 'Agent self',
        configuration: { permission_mode: 'default', env_vars: { TOKEN: 'secret' } }
      })
    })

    it.each(Object.values(BUILTIN_AGENT_ROLE))('refuses every new field for the built-in %s Agent', async (role) => {
      const id = seedBuiltinAgent(role)

      const result = await callBuiltinTool(cherryToolsServer(id), 'config_update', { description: 'Changed' })

      expect(result.isError).toBe(true)
      expect(toolText(result)).toContain('Built-in Agents cannot change these settings')
      expect(agentService.getAgent(id)?.description).toBe('Original description')
    })

    it('previews against the Agent that owns the Session', () => {
      seedAgent('self')
      const session = createSession('self')

      expect(
        previewAgentConfigUpdate({ tool: 'config_update', sessionId: session.id, input: { emoji: '🐼' } })
      ).toEqual({ ok: true, summary: ['Avatar: 🦊 → 🐼'] })
    })
  })
})
