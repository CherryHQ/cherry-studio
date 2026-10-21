import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { mcpServerService } from '@data/services/McpServerService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { McpResource } from '@shared/types/mcp'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

import { skillRelativePath, skillRoot, validateMcpSkill, verifyMcpSkillFile } from './mcpSkillContent'

type HeldSkill = {
  entry: McpSkillEntry
  serverKey: string
  loaded: boolean
  invalid: boolean
  abort: AbortController
  files: Map<string, McpResource>
}
type SkillSession = {
  agentId: string
  abort: AbortController
  skills: Map<string, HeldSkill>
  loads: Map<string, Promise<{ entry: McpSkillEntry; content: McpResource }>>
}

const keyOf = (serverId: string, uri: string) => JSON.stringify([serverId, uri])
const manifestOf = (entry: McpSkillEntry) => ({
  frontmatter: entry.frontmatter,
  resources: entry.resources === 'dynamic' ? 'dynamic' : [...entry.resources].sort((a, b) => a.uri.localeCompare(b.uri))
})
const executionTools = new Set([
  'Bash',
  'bash',
  'codemode',
  'Skill',
  'Agent',
  'Task',
  'mcp__automation__js',
  'mcp__skills__install_skill',
  'mcp__mcp-manager__install_mcp_server',
  'mcp__cherry-tools__cli_install'
])

@Injectable('McpSkillService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService', 'McpCatalogService'])
export class McpSkillService extends BaseService {
  private readonly sessions = new Map<string, SkillSession>()

  protected async onInit(): Promise<void> {
    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates }) => {
        if (updates.mcps === undefined) return
        for (const session of this.sessions.values()) {
          if (session.agentId !== agentId) continue
          session.abort.abort()
          session.abort = new AbortController()
          for (const held of session.skills.values()) {
            try {
              this.assertHeld(session, held)
            } catch {
              this.invalidate(held)
            }
          }
        }
      })
    )
    this.registerDisposable(
      mcpServerService.onChanged((serverId) => {
        for (const session of this.sessions.values()) {
          for (const held of session.skills.values()) {
            if (held.entry.serverId !== serverId) continue
            try {
              this.assertHeld(session, held)
            } catch {
              this.invalidate(held)
            }
          }
        }
      })
    )
    this.registerDisposable(
      application.get('McpRuntimeService').onServerInvalidated((serverId) => {
        for (const session of this.sessions.values()) {
          for (const held of session.skills.values()) {
            if (held.entry.serverId === serverId) this.invalidate(held)
          }
        }
      })
    )
  }

  protected async onStop(): Promise<void> {
    for (const sessionId of this.sessions.keys()) this.closeSession(sessionId)
  }

  openSession(sessionId: string, agentId: string): void {
    const existing = this.sessions.get(sessionId)
    if (existing) {
      if (existing.agentId !== agentId) {
        existing.agentId = agentId
        for (const held of existing.skills.values()) {
          this.invalidate(held)
        }
      }
      return
    }
    const session: SkillSession = { agentId, abort: new AbortController(), skills: new Map(), loads: new Map() }
    for (const entry of agentSessionMessageService.listMcpSkills(sessionId)) {
      validateMcpSkill(entry)
      const server = mcpServerService.findByIdOrName(entry.serverId)
      session.skills.set(keyOf(entry.serverId, entry.uri), {
        entry,
        serverKey: server ? application.get('McpRuntimeService').getServerKey(server) : '',
        loaded: true,
        invalid: !server,
        abort: new AbortController(),
        files: new Map()
      })
    }
    this.sessions.set(sessionId, session)
  }

  closeSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort.abort()
    this.sessions.delete(sessionId)
  }

  private session(sessionId: string): SkillSession {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('MCP skill session is not active')
    session.abort.signal.throwIfAborted()
    return session
  }

  private server(session: SkillSession, serverId: string) {
    const agent = agentService.getAgent(session.agentId)
    const server = mcpServerService.findByIdOrName(serverId)
    if (
      !server?.isActive ||
      server.id !== serverId ||
      !(agent?.mcps ?? []).some((id) => mcpServerService.findByIdOrName(id)?.id === server.id)
    )
      throw new Error('MCP server is not selected for this agent')
    return server
  }

  private invalidate(held: HeldSkill): void {
    held.invalid = true
    held.files.clear()
    held.abort.abort(new Error(t('mcp.skills.changed')))
  }

  private assertHeld(session: SkillSession, held: HeldSkill): void {
    session.abort.signal.throwIfAborted()
    try {
      const server = this.server(session, held.entry.serverId)
      if (application.get('McpRuntimeService').getServerKey(server) !== held.serverKey) this.invalidate(held)
    } catch {
      this.invalidate(held)
    }
    if (held.invalid) {
      throw new Error(t('mcp.skills.changed'))
    }
  }

  async list(sessionId: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const agent = agentService.getAgent(session.agentId)
    const serverIds = [
      ...new Set(
        (agent?.mcps ?? []).flatMap((id) => {
          const server = mcpServerService.findByIdOrName(id)
          return server?.isActive ? [server.id] : []
        })
      )
    ]
    const results = await Promise.all(
      serverIds.map(async (serverId) => {
        try {
          const entries = await application
            .get('McpCatalogService')
            .listSkills(serverId, AbortSignal.any([session.abort.signal, ...(signal ? [signal] : [])]))
          this.server(session, serverId)
          session.abort.signal.throwIfAborted()
          for (const entry of entries) this.observe(session, entry)
          return { serverId, skills: entries }
        } catch (error) {
          return { serverId, skills: [], error: error instanceof Error ? error.message : String(error) }
        }
      })
    )
    session.abort.signal.throwIfAborted()
    signal?.throwIfAborted()
    return results
  }

  private observe(session: SkillSession, entry: McpSkillEntry): void {
    const held = session.skills.get(keyOf(entry.serverId, entry.uri))
    if (held?.loaded && !isDeepStrictEqual(manifestOf(held.entry), manifestOf(entry))) {
      this.invalidate(held)
    }
  }

  async get(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    this.server(session, serverId)
    const entry = await application
      .get('McpRuntimeService')
      .getSkill(serverId, uri, AbortSignal.any([session.abort.signal, ...(signal ? [signal] : [])]))
    this.server(session, serverId)
    session.abort.signal.throwIfAborted()
    this.observe(session, entry)
    return entry
  }

  async load(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const key = keyOf(serverId, uri)
    const pending = session.loads.get(key)
    if (pending) return pending
    const run = this.loadOnce(sessionId, serverId, uri, signal)
    session.loads.set(key, run)
    try {
      return await run
    } finally {
      if (session.loads.get(key) === run) session.loads.delete(key)
    }
  }

  private async loadOnce(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const requestSignal = AbortSignal.any([session.abort.signal, ...(signal ? [signal] : [])])
    const entry = await this.get(sessionId, serverId, uri, requestSignal)
    if (entry.resources === 'dynamic') throw new Error(t('mcp.skills.dynamic'))
    const key = keyOf(serverId, uri)
    const existing = session.skills.get(key)
    const held = existing?.loaded
      ? existing
      : {
          entry,
          serverKey: application.get('McpRuntimeService').getServerKey(this.server(session, serverId)),
          loaded: false,
          invalid: false,
          abort: new AbortController(),
          files: new Map<string, McpResource>()
        }
    session.skills.set(key, held)
    this.assertHeld(session, held)
    const file = await this.readHeld(sessionId, held, uri, requestSignal)
    this.assertHeld(session, held)
    application.get('AgentSessionRuntimeService').recordMcpSkillLoad(sessionId, entry)
    held.loaded = true
    return { entry: structuredClone(held.entry), content: file }
  }

  private async readHeld(sessionId: string, held: HeldSkill, uri: string, signal?: AbortSignal): Promise<McpResource> {
    const session = this.session(sessionId)
    this.assertHeld(session, held)
    skillRelativePath(skillRoot(held.entry.uri), uri)
    if (held.entry.resources === 'dynamic' || !held.entry.resources.some((file) => file.uri === uri)) {
      this.invalidate(held)
      throw new Error('File is not in the held skill manifest')
    }
    const cached = held.files.get(uri)
    signal?.throwIfAborted()
    if (cached) {
      await this.guardResourceRead(
        sessionId,
        held.entry.serverId,
        uri,
        AbortSignal.any([session.abort.signal, held.abort.signal, ...(signal ? [signal] : [])]),
        async () => ({ contents: [cached] })
      )
      return structuredClone(cached)
    }
    const result = await application.get('McpRuntimeService').getResource({
      serverId: held.entry.serverId,
      uri,
      signal: AbortSignal.any([session.abort.signal, held.abort.signal, ...(signal ? [signal] : [])]),
      cacheMode: 'refresh',
      interactionContext: { sessionId }
    })
    this.assertHeld(session, held)
    const file = this.verify(held, uri, result.contents)
    held.files.set(uri, file)
    return structuredClone(file)
  }

  private verify(held: HeldSkill, uri: string, contents: McpResource[]): McpResource {
    try {
      if (contents.length !== 1 || contents[0].uri !== uri)
        throw new Error('Skill read must return exactly the requested resource')
      const file = contents[0]
      const bytes =
        typeof file.text === 'string'
          ? Buffer.from(file.text, 'utf8')
          : typeof file.blob === 'string'
            ? Buffer.from(file.blob, 'base64')
            : undefined
      if (!bytes) throw new Error('Skill resource has no content')
      verifyMcpSkillFile(held.entry, uri, bytes)
      return file
    } catch (error) {
      this.invalidate(held)
      throw error
    }
  }

  async read(sessionId: string, serverId: string, skillUri: string, uri: string, signal?: AbortSignal) {
    const held = this.session(sessionId).skills.get(keyOf(serverId, skillUri))
    if (!held?.loaded) throw new Error('Load this skill before reading its files')
    return this.readHeld(sessionId, held, uri, signal)
  }

  guardTool(sessionId: string, toolName: string): string | undefined {
    const session = this.sessions.get(sessionId)
    if (!session || toolName === 'mcp__skills__list_mcp_skills') return undefined
    try {
      for (const held of session.skills.values()) {
        if (held.loaded) this.assertHeld(session, held)
      }
    } catch (error) {
      return error instanceof Error ? error.message : String(error)
    }
    return undefined
  }

  toolApproval(
    sessionId: string,
    toolName: string,
    input: Record<string, unknown>,
    permissionMode?: AgentPermissionMode
  ) {
    if (permissionMode === 'bypassPermissions') return undefined
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const active = [...session.skills.values()].filter((held) => held.loaded)
    const nested =
      toolName === 'mcp__skills__load_mcp_skill' &&
      active.some(
        (held) =>
          input.server_id === held.entry.serverId &&
          typeof input.skill_uri === 'string' &&
          input.skill_uri !== held.entry.uri &&
          input.skill_uri.startsWith(`${skillRoot(held.entry.uri)}/`)
      )
    if (!active.length || (!nested && !executionTools.has(toolName))) return undefined
    const validate = () => {
      session.abort.signal.throwIfAborted()
      for (const held of active) this.assertHeld(session, held)
      if ([...session.skills.values()].filter((held) => held.loaded).length !== active.length)
        throw new Error(t('mcp.skills.changed'))
    }
    validate()
    return {
      signal: AbortSignal.any([session.abort.signal, ...active.map((held) => held.abort.signal)]),
      validate
    }
  }

  async guardResourceRead<T extends { contents: McpResource[] }>(
    sessionId: string,
    serverId: string,
    uri: string,
    signal: AbortSignal,
    run: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const session = this.sessions.get(sessionId)
    if (!session) return run(signal)
    const active = [...session.skills.values()].filter((held) => held.loaded)
    if (!active.length) return run(signal)
    signal = AbortSignal.any([signal, session.abort.signal, ...active.map((held) => held.abort.signal)])
    const target = this.server(session, serverId)
    const runtime = application.get('McpRuntimeService')
    const targetKey = runtime.getServerKey(target)
    const invalidated = new AbortController()
    const checkTarget = () => {
      try {
        if (runtime.getServerKey(this.server(session, serverId)) === targetKey) return
      } catch {
        // A removed or disabled origin cannot finish an authorized read.
      }
      invalidated.abort(new Error(t('mcp.skills.changed')))
    }
    const changed = mcpServerService.onChanged((id) => {
      if (id === serverId) checkTarget()
    })
    const closed = runtime.onServerInvalidated((id) => {
      if (id === serverId) invalidated.abort(new Error(t('mcp.skills.changed')))
    })
    signal = AbortSignal.any([signal, invalidated.signal])
    try {
      const foreign = active.filter((held) => held.entry.serverId !== serverId)
      for (const held of active) {
        this.assertHeld(session, held)
      }
      if (foreign.length) {
        const decision = await application.get('AgentSessionRuntimeService').requestToolApproval(sessionId, {
          toolName: 'mcp__skills__read_mcp_skill_file',
          input: {
            source_servers: foreign.map(({ entry }) => ({
              id: entry.serverId,
              name: entry.serverName,
              skill_uri: entry.uri
            })),
            server_id: serverId,
            server_name: target.name,
            resource_uri: uri
          },
          signal
        })
        if (!decision.approved) throw new Error(decision.reason ?? t('mcp.skills.denied'))
      }
      const matching = active.filter(
        (held) => held.entry.serverId === serverId && uri.startsWith(`${skillRoot(held.entry.uri)}/`)
      )
      for (const held of matching) {
        if (held.entry.resources === 'dynamic' || !held.entry.resources.some((file) => file.uri === uri)) {
          this.invalidate(held)
          throw new Error('File is not in the held skill manifest')
        }
      }
      signal.throwIfAborted()
      const result = await run(signal)
      signal.throwIfAborted()
      session.abort.signal.throwIfAborted()
      for (const held of active) this.assertHeld(session, held)
      for (const held of matching) this.verify(held, uri, result.contents)
      return result
    } finally {
      changed.dispose()
      closed.dispose()
    }
  }
}
