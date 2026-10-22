import { createHash, randomUUID } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { agentSessionMessageService } from '@data/services/AgentSessionMessageService'
import { mcpServerService } from '@data/services/McpServerService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { AgentPermissionMode } from '@shared/data/api/schemas/agents'
import type { McpResource } from '@shared/types/mcp'
import { McpSkillEntrySchema, type McpSkillEntry } from '@shared/types/mcpSkills'

import { skillRelativePath, skillRoot, validateMcpSkill, verifyMcpSkillFile } from './mcpSkillContent'

type HeldSkill = {
  sessionId: string
  entry: McpSkillEntry
  originFingerprint: string
  loaded: boolean
  invalid: boolean
  abort: AbortController
  files: Map<string, McpResource>
}
type SkillSession = {
  agentId: string
  abort: AbortController
  skills: Map<string, HeldSkill>
  loadTargets: Map<string, { fingerprint: string; abort: AbortController }>
  loadApprovals: Map<
    string,
    { serverId: string; uri: string; signal: AbortSignal; validate: () => void; dispose: () => void }
  >
  loads: Map<string, Promise<{ entry: McpSkillEntry; content: McpResource }>>
}

const fingerprintOf = (serverKey: string) => createHash('sha256').update(serverKey).digest('hex')
const loadApprovalInput = '__cherry_mcp_skill_approval'
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
  'mcp__cherry-tools__session_create',
  'mcp__cherry-tools__session_send',
  'mcp__cherry_tools__session_create',
  'mcp__cherry_tools__session_send',
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
        const server = mcpServerService.findByIdOrName(serverId)
        const fingerprint = server?.isActive
          ? fingerprintOf(application.get('McpRuntimeService').getServerKey(server))
          : undefined
        for (const session of this.sessions.values()) {
          const target = session.loadTargets.get(serverId)
          if (target && target.fingerprint !== fingerprint) target.abort.abort(new Error(t('mcp.skills.changed')))
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
          session.loadTargets.get(serverId)?.abort.abort(new Error(t('mcp.skills.changed')))
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
    const session: SkillSession = {
      agentId,
      abort: new AbortController(),
      skills: new Map(),
      loads: new Map(),
      loadTargets: new Map(),
      loadApprovals: new Map()
    }
    for (const context of agentSessionMessageService.listMcpSkills(sessionId)) {
      const entry = McpSkillEntrySchema.parse(context)
      validateMcpSkill(entry)
      const server = mcpServerService.findByIdOrName(entry.serverId)
      const key = keyOf(entry.serverId, entry.uri)
      if (session.skills.get(key)?.invalid) continue
      const held: HeldSkill = {
        sessionId,
        entry,
        originFingerprint: context.originFingerprint,
        loaded: true,
        invalid: context.invalidated,
        abort: new AbortController(),
        files: new Map()
      }
      session.skills.set(key, held)
      if (
        !server ||
        fingerprintOf(application.get('McpRuntimeService').getServerKey(server)) !== held.originFingerprint
      ) {
        this.invalidate(held)
      }
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
    const wasInvalid = held.invalid
    held.invalid = true
    held.files.clear()
    held.abort.abort(new Error(t('mcp.skills.changed')))
    if (held.loaded && !wasInvalid)
      agentSessionMessageService.invalidateMcpSkill(held.sessionId, held.entry.serverId, held.entry.uri)
  }

  private assertHeld(session: SkillSession, held: HeldSkill): void {
    session.abort.signal.throwIfAborted()
    try {
      const server = this.server(session, held.entry.serverId)
      if (fingerprintOf(application.get('McpRuntimeService').getServerKey(server)) !== held.originFingerprint)
        this.invalidate(held)
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

  async loadFromTool(
    sessionId: string,
    input: { server_id: string; skill_uri: string; [key: string]: unknown },
    signal: AbortSignal
  ) {
    const session = this.session(sessionId)
    const token = input[loadApprovalInput]
    if (
      token === undefined &&
      agentService.getAgent(session.agentId)?.configuration?.permission_mode === 'bypassPermissions'
    )
      return this.load(sessionId, input.server_id, input.skill_uri, signal)
    const approval = typeof token === 'string' ? session.loadApprovals.get(token) : undefined
    if (!approval) throw new Error(t('mcp.skills.changed'))
    approval.dispose()
    if (approval.serverId !== input.server_id || approval.uri !== input.skill_uri)
      throw new Error(t('mcp.skills.changed'))
    approval.validate()
    const requestSignal = AbortSignal.any([signal, approval.signal])
    requestSignal.throwIfAborted()
    const result = await this.load(sessionId, input.server_id, input.skill_uri, requestSignal)
    requestSignal.throwIfAborted()
    return result
  }

  private async loadOnce(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const requestSignal = AbortSignal.any([session.abort.signal, ...(signal ? [signal] : [])])
    const originFingerprint = fingerprintOf(
      application.get('McpRuntimeService').getServerKey(this.server(session, serverId))
    )
    const entry = await this.get(sessionId, serverId, uri, requestSignal)
    if (entry.resources === 'dynamic') throw new Error(t('mcp.skills.dynamic'))
    const key = keyOf(serverId, uri)
    const existing = session.skills.get(key)
    const held = existing?.loaded
      ? existing
      : {
          sessionId,
          entry,
          originFingerprint,
          loaded: false,
          invalid: false,
          abort: new AbortController(),
          files: new Map<string, McpResource>()
        }
    session.skills.set(key, held)
    this.assertHeld(session, held)
    const file = await this.readHeld(sessionId, held, uri, requestSignal)
    this.assertHeld(session, held)
    application
      .get('AgentSessionRuntimeService')
      .recordMcpSkillLoad(sessionId, { ...entry, originFingerprint: held.originFingerprint, invalidated: false })
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
    permissionMode?: AgentPermissionMode,
    requestSignal?: AbortSignal
  ) {
    if (permissionMode === 'bypassPermissions') return undefined
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const active = [...session.skills.values()].filter((held) => held.loaded)
    const isLoad = toolName === 'mcp__skills__load_mcp_skill'
    if (!isLoad && (!active.length || !executionTools.has(toolName))) return undefined
    let target: { fingerprint: string; abort: AbortController } | undefined
    const targetId = isLoad && typeof input.server_id === 'string' ? input.server_id : undefined
    if (targetId) {
      const fingerprint = fingerprintOf(
        application.get('McpRuntimeService').getServerKey(this.server(session, targetId))
      )
      target = session.loadTargets.get(targetId)
      if (!target || target.abort.signal.aborted || target.fingerprint !== fingerprint) {
        target = { fingerprint, abort: new AbortController() }
        session.loadTargets.set(targetId, target)
      }
    }
    const signal = AbortSignal.any([
      session.abort.signal,
      ...active.map((held) => held.abort.signal),
      ...(target ? [target.abort.signal] : []),
      ...(requestSignal ? [requestSignal] : [])
    ])
    const validate = () => {
      signal.throwIfAborted()
      if (
        target &&
        targetId &&
        fingerprintOf(application.get('McpRuntimeService').getServerKey(this.server(session, targetId))) !==
          target.fingerprint
      )
        throw new Error(t('mcp.skills.changed'))
      for (const held of active) this.assertHeld(session, held)
      if ([...session.skills.values()].filter((held) => held.loaded).length !== active.length)
        throw new Error(t('mcp.skills.changed'))
    }
    validate()
    return {
      signal,
      approve: () => {
        validate()
        if (!targetId || typeof input.skill_uri !== 'string') return { ...input }
        const token = randomUUID()
        const dispose = () => {
          session.loadApprovals.delete(token)
          signal.removeEventListener('abort', dispose)
        }
        session.loadApprovals.set(token, { serverId: targetId, uri: input.skill_uri, signal, validate, dispose })
        signal.addEventListener('abort', dispose, { once: true })
        return { ...input, [loadApprovalInput]: token }
      }
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
