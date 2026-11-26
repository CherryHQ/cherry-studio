import type {
  ContentBlock,
  NewSessionRequest,
  Plan,
  SessionNotification,
  SessionUpdate,
  ToolCallUpdate,
  UsageUpdate
} from '@agentclientprotocol/sdk'

import type { AcpAgent, AcpSession } from './client'
import type { AcpHarnessAdapter, AcpNativeTurn } from './harness'
import type { AcpSessionConfiguration } from './types'

type ConfigureSession = (session: Pick<AcpSession, 'setConfigOption' | 'legacyModels'>) => Promise<void>

type ToolPatch = {
  [K in Exclude<keyof ToolCallUpdate, 'toolCallId' | '_meta'>]?: NonNullable<ToolCallUpdate[K]>
}

export interface AcpLiveEvents {
  opened(session: AcpLiveSession, configuration: AcpSessionConfiguration): void
  nativeTurn?(event: AcpNativeTurn): boolean
  content(kind: 'text' | 'reasoning', block: ContentBlock, messageId?: string): void
  tool(id: string, patch: ToolPatch): void
  plan(entries: Plan['entries']): void
  title(title: string): void
  notice(notice: { title: string; description?: string; severity: 'info' | 'warning' | 'error' }): void
  usage(usage: UsageUpdate): void
  commands(commands: { name: string; description: string; argumentHint: string }[]): void
  mode(id: string): void
  options(options: NonNullable<AcpSessionConfiguration['configOptions']>): void
  compaction(
    event: { type: 'compaction-start' | 'compaction-complete' } | { type: 'compaction-error'; error: string }
  ): void
}

function setupUpdate(update: SessionUpdate, harness?: AcpHarnessAdapter) {
  switch (update.sessionUpdate) {
    case 'available_commands_update':
    case 'config_option_update':
    case 'usage_update':
    case 'session_info_update':
    case 'notice':
    case 'current_mode_update':
      return true
    default:
      return (
        update.sessionUpdate === 'agent_message_chunk' &&
        update.content.type === 'text' &&
        harness?.setupUpdate === update.sessionUpdate
      )
  }
}

function liveSession(session: AcpSession, events: AcpLiveEvents, currentModel: () => string | undefined) {
  const harness = session.bindHarness(currentModel)
  const compact = harness?.compact
  const compactions = new Map<string, boolean>()
  let activeCompactions = 0
  let prompting = false
  let compacting = false
  let native:
    | {
        start: Extract<AcpNativeTurn, { state: 'started' }>
        observing: boolean
        updates: SessionUpdate[]
        finished?: Extract<AcpNativeTurn, { state: 'finished' }>
      }
    | undefined

  function drainNativeTurn() {
    if (!native || prompting || compacting || native.observing) return
    const turn = native
    if (!events.nativeTurn?.(turn.start)) {
      native = undefined
      return
    }
    turn.observing = true
    for (const update of turn.updates) receive(update)
    turn.updates.length = 0
    if (turn.finished) acceptNativeTurn(turn.finished)
  }

  function acceptNativeTurn(event: AcpNativeTurn) {
    if (event.state === 'started') {
      if (native) return
      native = { start: event, observing: false, updates: [] }
      drainNativeTurn()
    } else if (native?.start.id === event.id) {
      if (native.observing) {
        native = undefined
        events.nativeTurn?.(event)
      } else native.finished ??= event
    }
  }

  function finish() {
    prompting = false
    compactions.clear()
    if (activeCompactions) {
      activeCompactions = 0
      events.compaction({ type: 'compaction-complete' })
    }
  }

  function receive(update: SessionUpdate) {
    if (native && !native.observing && !setupUpdate(update)) {
      // Bound the overlap while the preceding prompt waits for its RPC response.
      if (native.updates.length === 256) {
        native.finished = {
          state: 'finished',
          sessionId: session.id,
          id: native.start.id,
          error: 'ACP native turn exceeded the pending update limit'
        }
      }
      if (!native.finished) native.updates.push(update)
      return
    }
    harness?.observeUpdate?.(update)
    switch (update.sessionUpdate) {
      case 'agent_message_chunk':
        if (update.content.type === 'text' && harness?.consumeAssistantText?.(update.content.text)) return
        if (prompting || native?.observing) events.content('text', update.content, update.messageId ?? undefined)
        return
      case 'agent_thought_chunk':
        if (prompting || native?.observing) events.content('reasoning', update.content, update.messageId ?? undefined)
        return
      case 'plan':
        if (prompting || native?.observing) events.plan(update.entries)
        return
      case 'tool_call':
      case 'tool_call_update': {
        if (!prompting && !native?.observing) return
        const { title, name, kind, status, content, locations, rawInput, rawOutput } = update
        events.tool(update.toolCallId, {
          ...(title != null && { title }),
          ...(name != null && { name }),
          ...(kind != null && { kind }),
          ...(status != null && { status }),
          ...(content != null && { content }),
          ...(locations != null && { locations }),
          ...(rawInput != null && { rawInput }),
          ...(rawOutput != null && { rawOutput })
        })
        return
      }
      case 'compaction_update': {
        if (compacting) return
        const { compactionId, status, error } = update
        if (status === 'in_progress') {
          if (compactions.has(compactionId)) return
          compactions.set(compactionId, true)
          if (++activeCompactions === 1) events.compaction({ type: 'compaction-start' })
        } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          const active = compactions.get(compactionId)
          compactions.set(compactionId, false)
          if (active && --activeCompactions === 0) {
            events.compaction(
              status === 'failed' && error ? { type: 'compaction-error', error } : { type: 'compaction-complete' }
            )
          }
        }
        return
      }
      case 'session_info_update':
        if (update.title?.trim()) events.title(update.title)
        return
      case 'notice':
        if (update.title.trim())
          events.notice({
            title: update.title,
            description: update.description ?? undefined,
            severity: update.severity === 'warning' || update.severity === 'error' ? update.severity : 'info'
          })
        return
      case 'usage_update':
        if (!compacting) events.usage(update)
        return
      case 'available_commands_update':
        events.commands(
          update.availableCommands.map(({ name, description, input }) => ({
            name,
            description,
            argumentHint: input?.hint ?? ''
          }))
        )
        return
      case 'config_option_update':
        events.options(update.configOptions)
        return
      case 'current_mode_update':
        events.mode(update.currentModeId)
        return
      case 'user_message_chunk':
      case 'compaction_summary_chunk':
        return
      default:
        update satisfies never
    }
  }

  return {
    receive,
    finish,
    acceptNativeTurn,
    session: {
      id: session.id,
      drainNativeTurn,
      get awaitingNativeTurn() {
        return native !== undefined && !native.observing
      },
      cancel: session.cancel,
      close: session.close,
      legacyModels: session.legacyModels,
      legacyEffort: harness?.legacyEffort,
      setMode: session.setMode,
      setConfigOption: session.setConfigOption,
      inspectContextUsage: harness?.inspectContextUsage,
      predictPrompt: harness?.predictPrompt,
      steer: harness?.steer,
      compact:
        compact &&
        (async () => {
          if (prompting || compacting || native)
            return {
              status: 'rejected' as const,
              error: { operation: 'compact', code: 'busy', message: 'ACP session is busy' }
            }
          compacting = true
          try {
            return await compact()
          } finally {
            compacting = false
            drainNativeTurn()
          }
        }),
      async prompt(content: ContentBlock[], revision: string) {
        if (prompting || compacting || native) throw new Error('ACP session is busy')
        prompting = true
        try {
          const { response, usage } = await session.prompt(content, harness?.promptMeta)
          return { stopReason: response.stopReason, usage, context: harness?.contextAfterPrompt?.(response, revision) }
        } finally {
          finish()
        }
      }
    }
  }
}

export type AcpLiveSession = ReturnType<typeof liveSession>['session']

export class AcpLiveUpdates {
  private route?: (notification: SessionNotification) => void
  private finish?: () => void
  private routeNativeTurn?: (event: AcpNativeTurn) => void

  constructor(
    private readonly events: AcpLiveEvents,
    private readonly currentModel: () => string | undefined,
    private readonly harness?: AcpHarnessAdapter
  ) {}

  receive(notification: SessionNotification) {
    this.route?.(notification)
  }

  nativeTurn(event: AcpNativeTurn) {
    this.routeNativeTurn?.(event)
  }

  close() {
    this.route = undefined
    this.routeNativeTurn = undefined
    this.finish?.()
    this.finish = undefined
  }

  agent(agent: AcpAgent, signal: AbortSignal) {
    const restore =
      this.harness?.preferredRestore === 'load' ? (agent.load ?? agent.resume) : (agent.resume ?? agent.load)
    const open = async (
      request: () => Promise<{ session: AcpSession; configuration: AcpSessionConfiguration }>,
      configure: ConfigureSession,
      restoring?: string
    ) => {
      signal.throwIfAborted()
      if (this.route) throw new Error('The desktop ACP connection already owns a session')
      const pending: SessionNotification[] = []
      let expectedId = restoring
      this.route = (params) => {
        if (
          (!expectedId || params.sessionId === expectedId) &&
          setupUpdate(params.update, restoring ? undefined : this.harness)
        )
          pending.push(params)
      }
      try {
        const { session, configuration } = await request()
        signal.throwIfAborted()
        const live = liveSession(session, this.events, this.currentModel)
        this.finish = live.finish
        expectedId = session.id
        const deliver = ({ sessionId, update }: SessionNotification) => {
          if (sessionId === session.id) live.receive(update)
        }
        const flush = () => {
          for (const notification of pending) deliver(notification)
          pending.length = 0
        }
        this.events.opened(live.session, configuration)
        flush()
        await configure(live.session)
        signal.throwIfAborted()
        this.route = deliver
        this.routeNativeTurn = (event) => {
          if (event.sessionId === session.id) live.acceptNativeTurn(event)
        }
        flush()
        return live.session
      } catch (error) {
        this.close()
        throw error
      }
    }
    return {
      response: agent.response,
      create: (params: NewSessionRequest, configure: ConfigureSession) => open(() => agent.create(params), configure),
      restore:
        restore &&
        ((params: Parameters<typeof restore>[0], configure: ConfigureSession) =>
          open(() => restore(params), configure, params.sessionId))
    }
  }
}
