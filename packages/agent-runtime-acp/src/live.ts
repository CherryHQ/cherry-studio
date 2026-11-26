import {
  RequestError,
  type ContentBlock,
  type NewSessionRequest,
  type Plan,
  type SessionNotification,
  type SessionUpdate,
  type ToolCallUpdate,
  type UsageUpdate
} from '@agentclientprotocol/sdk'

import { acpModelCatalog, type AcpAgent, type AcpSession } from './client'
import type { AcpHarnessAdapter, AcpNativeTurn } from './harness'
import type { AcpModelSelection } from './profile'
import type { AcpSessionConfiguration } from './types'

type ConfigureSession = (session: AcpLiveSession) => Promise<void>

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
  options(options: AcpSessionConfiguration['configOptions'], modes?: AcpSessionConfiguration['modes']): void
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

function liveSession(session: AcpSession, configuration: AcpSessionConfiguration, events: AcpLiveEvents) {
  let options = configuration.configOptions
  let modes = configuration.modes
  let legacy = session.legacyModels
  let catalog = acpModelCatalog(options, legacy)
  let optionsRevision = 0
  let unsupportedModelControl: string | undefined
  let modelSignInRequired = false
  let selectingModel = false
  const controls = () => options?.filter(({ id }) => id !== catalog.configId)
  const harness = session.bindHarness(() => catalog.activeModel?.id)

  function updateOptions(next: AcpSessionConfiguration['configOptions']) {
    optionsRevision++
    options = next
    catalog = acpModelCatalog(options, legacy)
    modelSignInRequired = false
    events.options(controls(), options == null ? modes : undefined)
  }

  async function selectModel(modelId: string, initial?: AcpModelSelection) {
    if (catalog.activeModel?.id === modelId) return
    if (prompting || compacting || native || selectingModel) throw new Error('ACP session is busy')
    const { configId, models } = catalog
    const control = configId ?? (legacy && 'legacy')
    if (!control || control === unsupportedModelControl) {
      if (initial?.implicit === modelId && !models.length) {
        catalog = { ...catalog, activeModel: { id: modelId } }
        events.options(controls(), options == null ? modes : undefined)
        return
      }
      throw new Error('This ACP session does not support model switching')
    }
    if (
      !models.some(({ id }) => id === modelId) &&
      !(initial && (!models.length || (initial.allowUnlisted && configId)))
    )
      throw new Error('This model is no longer available in the ACP session')

    selectingModel = true
    const revision = optionsRevision
    try {
      if (configId) {
        const response = await session.setConfigOption(configId, modelId)
        if (optionsRevision === revision && response.configOptions) updateOptions(response.configOptions)
        if (catalog.activeModel?.id !== modelId) throw new Error('The ACP session did not confirm the selected model')
      } else if (legacy) {
        // A successful legacy response acknowledges the requested model ID.
        await legacy.select(modelId)
        legacy = { ...legacy, currentModelId: modelId }
        updateOptions(options)
      }
    } catch (error) {
      if (error instanceof RequestError && error.code === RequestError.methodNotFound('').code) {
        unsupportedModelControl = control
        events.options(controls(), options == null ? modes : undefined)
      } else if (error instanceof RequestError && error.code === RequestError.authRequired().code) {
        modelSignInRequired = true
        events.options(controls(), options == null ? modes : undefined)
      }
      throw error
    } finally {
      selectingModel = false
    }
  }
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
        updateOptions(update.configOptions)
        return
      case 'current_mode_update':
        if (modes) modes = { ...modes, currentModeId: update.currentModeId }
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
    controls,
    session: {
      id: session.id,
      drainNativeTurn,
      get awaitingNativeTurn() {
        return native !== undefined && !native.observing
      },
      cancel: session.cancel,
      close: session.close,
      get model() {
        const control = catalog.configId ?? (legacy && 'legacy')
        return {
          activeModel: catalog.activeModel,
          models: catalog.models,
          status: modelSignInRequired
            ? ('sign-in-required' as const)
            : !control || unsupportedModelControl === control
              ? ('unsupported' as const)
              : !catalog.models.length
                ? ('empty' as const)
                : catalog.models.some(({ id }) => id !== catalog.activeModel?.id)
                  ? ('selectable' as const)
                  : ('current-only' as const)
        }
      },
      selectModel: (modelId: string) => selectModel(modelId),
      selectInitialModel: (modelId: string, selection: AcpModelSelection) => selectModel(modelId, selection),
      legacyEffort: harness?.legacyEffort,
      setMode: session.setMode,
      async setConfigOption(configId: string, value: string | boolean) {
        if (configId === catalog.configId) throw new Error('Use the ACP session model control')
        const revision = optionsRevision
        const response = await session.setConfigOption(configId, value)
        if (optionsRevision === revision && response.configOptions) updateOptions(response.configOptions)
      },
      inspectContextUsage: harness?.inspectContextUsage,
      predictPrompt: harness?.predictPrompt,
      steer: harness?.steer,
      compact:
        compact &&
        (async () => {
          if (prompting || compacting || native || selectingModel)
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
        if (prompting || compacting || native || selectingModel) throw new Error('ACP session is busy')
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
        const live = liveSession(session, configuration, this.events)
        this.finish = live.finish
        expectedId = session.id
        const deliver = ({ sessionId, update }: SessionNotification) => {
          if (sessionId === session.id) live.receive(update)
        }
        const flush = () => {
          for (const notification of pending) deliver(notification)
          pending.length = 0
        }
        this.events.opened(live.session, { ...configuration, configOptions: live.controls() })
        flush()
        this.route = deliver
        await configure(live.session)
        signal.throwIfAborted()
        this.routeNativeTurn = (event) => {
          if (event.sessionId === session.id) live.acceptNativeTurn(event)
        }
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
