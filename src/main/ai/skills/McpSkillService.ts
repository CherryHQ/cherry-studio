import { isDeepStrictEqual } from 'node:util'

import { application } from '@application'
import { agentService } from '@data/services/AgentService'
import { mcpServerService } from '@data/services/McpServerService'
import { BaseService, DependsOn, Injectable, Phase, ServicePhase } from '@main/core/lifecycle'
import { t } from '@main/i18n'
import type { McpResource } from '@shared/types/mcp'
import type { McpSkillEntry } from '@shared/types/mcpSkills'

import { skillRelativePath, skillRoot, verifyMcpSkillFile } from './mcpSkillContent'

type OriginState = { key: string; abort: AbortController }
type HeldSkill = {
  sessionId: string
  entry: McpSkillEntry
  origin: OriginState
  loaded: boolean
  abort: AbortController
  files: Map<string, McpResource>
}
type SessionSkillState = {
  agentId: string
  abort: AbortController
  skills: Map<string, HeldSkill>
  origins: Map<string, OriginState>
  loads: Map<
    string,
    {
      result: Promise<{ entry: McpSkillEntry; content: McpResource }>
      abort: AbortController
      observed?: McpSkillEntry
    }
  >
}

const keyOf = (serverId: string, uri: string) => JSON.stringify([serverId, uri])
const manifestOf = (entry: McpSkillEntry) => ({
  frontmatter: entry.frontmatter,
  resources: entry.resources === 'dynamic' ? 'dynamic' : [...entry.resources].sort((a, b) => a.uri.localeCompare(b.uri))
})

@Injectable('McpSkillService')
@ServicePhase(Phase.WhenReady)
@DependsOn(['McpRuntimeService', 'McpCatalogService'])
export class McpSkillService extends BaseService {
  private readonly sessions = new Map<string, SessionSkillState>()

  protected async onInit(): Promise<void> {
    this.registerDisposable(
      application.get('McpCatalogService').onSkillsObserved((entries) => {
        for (const entry of entries) this.observeEntry(entry)
      })
    )
    this.registerDisposable(
      agentService.onAgentUpdated(({ agentId, updates }) => {
        if (updates.mcps === undefined) return
        for (const session of this.sessions.values()) {
          if (session.agentId !== agentId) continue
          session.abort.abort()
          session.abort = new AbortController()
          for (const [serverId, origin] of session.origins) {
            try {
              this.assertOrigin(session, serverId, origin)
            } catch {
              this.discardOrigin(session, serverId, origin)
            }
          }
        }
      })
    )
    this.registerDisposable(
      mcpServerService.onChanged((serverId) => {
        const server = mcpServerService.findByIdOrName(serverId)
        const serverKey = server?.isActive ? application.get('McpRuntimeService').getServerKey(server) : undefined
        for (const session of this.sessions.values()) {
          const origin = session.origins.get(serverId)
          if (origin && origin.key !== serverKey) this.discardOrigin(session, serverId, origin)
        }
      })
    )
    this.registerDisposable(
      application.get('McpRuntimeService').onServerInvalidated((serverId) => {
        for (const session of this.sessions.values()) {
          const origin = session.origins.get(serverId)
          if (origin) this.discardOrigin(session, serverId, origin)
        }
      })
    )
  }

  protected async onStop(): Promise<void> {
    for (const sessionId of this.sessions.keys()) this.closeSession(sessionId)
  }

  openSession(sessionId: string, agentId: string): void {
    const existing = this.sessions.get(sessionId)
    if (existing?.agentId === agentId) return
    if (existing) this.closeSession(sessionId)
    this.sessions.set(sessionId, {
      agentId,
      abort: new AbortController(),
      skills: new Map(),
      loads: new Map(),
      origins: new Map()
    })
  }

  closeSession(sessionId: string): void {
    this.sessions.get(sessionId)?.abort.abort()
    this.sessions.delete(sessionId)
  }

  private session(sessionId: string): SessionSkillState {
    const session = this.sessions.get(sessionId)
    if (!session) throw new Error('MCP skill session is not active')
    session.abort.signal.throwIfAborted()
    return session
  }

  private server(session: SessionSkillState, serverId: string) {
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

  private discard(held: HeldSkill): void {
    held.files.clear()
    held.abort.abort(new Error(t('mcp.skills.changed')))
    const session = this.sessions.get(held.sessionId)
    const key = keyOf(held.entry.serverId, held.entry.uri)
    if (session?.skills.get(key) === held) session.skills.delete(key)
  }

  private assertHeld(session: SessionSkillState, held: HeldSkill): void {
    held.abort.signal.throwIfAborted()
    this.assertOrigin(session, held.entry.serverId, held.origin)
  }

  private discardOrigin(session: SessionSkillState, serverId: string, origin: OriginState): void {
    origin.abort.abort(new Error(t('mcp.skills.changed')))
    for (const held of session.skills.values()) {
      if (held.origin === origin) this.discard(held)
    }
    if (session.origins.get(serverId) === origin) session.origins.delete(serverId)
  }

  private assertOrigin(session: SessionSkillState, serverId: string, origin: OriginState): void {
    session.abort.signal.throwIfAborted()
    origin.abort.signal.throwIfAborted()
    try {
      const server = this.server(session, serverId)
      if (application.get('McpRuntimeService').getServerKey(server) === origin.key) return
    } catch {
      // A removed or deselected server cannot finish an active read.
    }
    this.discardOrigin(session, serverId, origin)
    throw new Error(t('mcp.skills.changed'))
  }

  captureOrigin(sessionId: string, serverId: string) {
    const session = this.session(sessionId)
    const server = this.server(session, serverId)
    const key = application.get('McpRuntimeService').getServerKey(server)
    let origin = session.origins.get(serverId)
    if (!origin || origin.abort.signal.aborted || origin.key !== key) {
      if (origin) this.discardOrigin(session, serverId, origin)
      origin = { key, abort: new AbortController() }
      session.origins.set(serverId, origin)
    }
    const captured = origin
    return {
      server,
      state: captured,
      signal: AbortSignal.any([session.abort.signal, captured.abort.signal]),
      validate: () => this.assertOrigin(session, serverId, captured)
    }
  }

  captureContext(sessionId: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const active = [...session.skills.values()].filter((held) => held.loaded)
    const signal = AbortSignal.any([session.abort.signal, ...active.map((held) => held.abort.signal)])
    return {
      signal,
      origins: active.map(({ entry }) => ({ serverId: entry.serverId, serverName: entry.serverName, uri: entry.uri })),
      validate: () => {
        signal.throwIfAborted()
        for (const held of active) this.assertHeld(session, held)
        if ([...session.skills.values()].filter((held) => held.loaded).length !== active.length)
          throw new Error(t('mcp.skills.changed'))
      }
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

  private observeEntry(entry: McpSkillEntry): void {
    for (const session of this.sessions.values()) this.observe(session, entry)
  }

  private observe(session: SessionSkillState, entry: McpSkillEntry): void {
    const key = keyOf(entry.serverId, entry.uri)
    const pending = session.loads.get(key)
    if (pending) {
      if (pending.observed && !isDeepStrictEqual(manifestOf(pending.observed), manifestOf(entry)))
        pending.abort.abort(new Error(t('mcp.skills.changed')))
      pending.observed ??= entry
    }
    const held = session.skills.get(key)
    if (held && !isDeepStrictEqual(manifestOf(held.entry), manifestOf(entry))) {
      this.discard(held)
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
    this.observeEntry(entry)
    return entry
  }

  async load(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const key = keyOf(serverId, uri)
    const pending = session.loads.get(key)
    if (pending) return pending.result
    const abort = new AbortController()
    const run = this.loadOnce(sessionId, serverId, uri, AbortSignal.any([abort.signal, ...(signal ? [signal] : [])]))
    session.loads.set(key, { result: run, abort })
    try {
      return await run
    } finally {
      if (session.loads.get(key)?.result === run) session.loads.delete(key)
    }
  }

  private async loadOnce(sessionId: string, serverId: string, uri: string, signal?: AbortSignal) {
    const session = this.session(sessionId)
    const origin = this.captureOrigin(sessionId, serverId)
    const requestSignal = AbortSignal.any([origin.signal, ...(signal ? [signal] : [])])
    const entry = await this.get(sessionId, serverId, uri, requestSignal)
    requestSignal.throwIfAborted()
    if (entry.resources === 'dynamic') throw new Error(t('mcp.skills.dynamic'))
    const key = keyOf(serverId, uri)
    const existing = session.skills.get(key)
    const held = existing?.loaded
      ? existing
      : {
          sessionId,
          entry,
          origin: origin.state,
          loaded: false,
          abort: new AbortController(),
          files: new Map<string, McpResource>()
        }
    session.skills.set(key, held)
    this.assertHeld(session, held)
    const file = await this.readHeld(sessionId, held, uri, requestSignal)
    this.assertHeld(session, held)
    held.loaded = true
    // oxlint-disable-next-line no-restricted-globals -- Isolate the held manifest, including arbitrary nested metadata, from tool callers.
    return { entry: structuredClone(held.entry), content: file }
  }

  private async readHeld(sessionId: string, held: HeldSkill, uri: string, signal?: AbortSignal): Promise<McpResource> {
    const session = this.session(sessionId)
    this.assertHeld(session, held)
    skillRelativePath(skillRoot(held.entry.uri), uri)
    if (held.entry.resources === 'dynamic' || !held.entry.resources.some((file) => file.uri === uri)) {
      this.discard(held)
      throw new Error('File is not in the held skill manifest')
    }
    const cached = held.files.get(uri)
    signal?.throwIfAborted()
    if (cached) {
      await application
        .get('McpRuntimeService')
        .guardResourceRead(
          sessionId,
          held.entry.serverId,
          uri,
          AbortSignal.any([session.abort.signal, held.abort.signal, ...(signal ? [signal] : [])]),
          async () => ({ contents: [cached] })
        )
      // oxlint-disable-next-line no-restricted-globals -- Prevent callers from mutating the verified cached resource and its nested metadata.
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
    const file = result.contents[0]
    held.files.set(uri, file)
    // oxlint-disable-next-line no-restricted-globals -- Keep the verified cache independent of the resource returned to tool callers.
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
      if (uri === held.entry.uri) {
        const content = { ...file, text: bytes.toString('utf8') }
        delete content.blob
        return content
      }
      return file
    } catch (error) {
      this.discard(held)
      throw error
    }
  }

  async read(sessionId: string, serverId: string, skillUri: string, uri: string, signal?: AbortSignal) {
    const held = this.session(sessionId).skills.get(keyOf(serverId, skillUri))
    if (!held?.loaded) throw new Error('Load this skill before reading its files')
    return this.readHeld(sessionId, held, uri, signal)
  }

  captureResourceRead(sessionId: string, serverId: string, uri: string) {
    const session = this.sessions.get(sessionId)
    if (!session) return undefined
    const context = this.captureContext(sessionId)!
    const matching = [...session.skills.values()].filter(
      (held) => held.entry.serverId === serverId && uri.startsWith(`${skillRoot(held.entry.uri)}/`)
    )
    if (!context.origins.length && !matching.length) return undefined
    const origin = this.captureOrigin(sessionId, serverId)
    context.validate()
    for (const held of matching) {
      this.assertHeld(session, held)
      if (held.entry.resources === 'dynamic' || !held.entry.resources.some((file) => file.uri === uri)) {
        this.discard(held)
        throw new Error('File is not in the held skill manifest')
      }
    }
    const signal = AbortSignal.any([context.signal, origin.signal, ...matching.map((held) => held.abort.signal)])
    return {
      signal,
      target: origin.server,
      origins: context.origins,
      verify: (contents: McpResource[]) => {
        signal.throwIfAborted()
        context.validate()
        origin.validate()
        for (const held of matching) this.assertHeld(session, held)
        const verified = matching.map((held) => this.verify(held, uri, contents))
        return verified.length ? [verified[0]] : contents
      }
    }
  }
}
