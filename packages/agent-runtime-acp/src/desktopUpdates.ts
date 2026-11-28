import {
  type ContentBlock,
  type Plan,
  type SessionUpdate,
  type ToolCallUpdate,
  type UsageUpdate
} from '@agentclientprotocol/sdk'

import type { AcpSession } from './client'
import type { AcpSessionControls } from './configuration'
import type { AcpHarnessAdapter, AcpNativeTurn } from './harness'
import type { AcpSessionConfiguration, AcpThreadHandle } from './types'

type ToolPatch = {
  [K in Exclude<keyof ToolCallUpdate, 'toolCallId' | '_meta'>]?: NonNullable<ToolCallUpdate[K]>
}

export interface AcpDesktopEvents {
  opened(session: AcpThreadHandle<true>, configuration: AcpSessionConfiguration): void
  nativeTurn?(event: AcpNativeTurn): boolean
  content(kind: 'text' | 'reasoning', block: ContentBlock, messageId?: string): void
  tool(id: string, patch: ToolPatch): void
  plan(entries: Plan['entries']): void
  title(title: string): void
  notice(notice: { title: string; description?: string; severity: 'info' | 'warning' | 'error' }): void
  usage(usage: UsageUpdate): void
  commands(commands: { name: string; description: string; argumentHint: string }[]): void
  options(options: AcpSessionConfiguration['configOptions'], modes?: AcpSessionConfiguration['modes']): void
  compaction(
    event: { type: 'compaction-start' | 'compaction-complete' } | { type: 'compaction-error'; error: string }
  ): void
}

export function acpSetupUpdate(update: SessionUpdate, harness?: AcpHarnessAdapter) {
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

export function bindDesktopUpdates(
  session: AcpSession,
  controls: AcpSessionControls,
  sink: AcpDesktopEvents,
  prompting: () => boolean
) {
  const harness = session.bindHarness(() => controls.model.activeModel?.id)
  let events: AcpDesktopEvents | undefined = sink
  let ready = false

  function publishOptions() {
    events?.options(controls.extraOptions, controls.snapshot.modes)
  }
  const compact = harness?.compact
  const compactions = new Map<string, boolean>()
  let activeCompactions = 0
  let compacting: PromiseWithResolvers<void> | undefined
  let native:
    | {
        start: Extract<AcpNativeTurn, { state: 'started' }>
        observing: boolean
        updates: SessionUpdate[]
        done: PromiseWithResolvers<void>
        finished?: Extract<AcpNativeTurn, { state: 'finished' }>
      }
    | undefined

  function drainNativeTurn() {
    if (!ready || !native || prompting() || compacting || controls.busy || native.observing) return
    const turn = native
    if (events && !events.nativeTurn?.(turn.start)) {
      turn.done.resolve()
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
      native = { start: event, observing: false, updates: [], done: Promise.withResolvers<void>() }
      drainNativeTurn()
    } else if (native?.start.id === event.id) {
      if (native.observing) {
        native.done.resolve()
        native = undefined
        events?.nativeTurn?.(event)
      } else native.finished ??= event
    }
  }

  function finish() {
    compactions.clear()
    if (activeCompactions) {
      activeCompactions = 0
      events?.compaction({ type: 'compaction-complete' })
    }
  }

  function receive(update: SessionUpdate) {
    if (native && !native.observing && !acpSetupUpdate(update)) {
      if (!events) return
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
        if (prompting() || native?.observing) events?.content('text', update.content, update.messageId ?? undefined)
        return
      case 'agent_thought_chunk':
        if (prompting() || native?.observing)
          events?.content('reasoning', update.content, update.messageId ?? undefined)
        return
      case 'plan':
        if (prompting() || native?.observing) events?.plan(update.entries)
        return
      case 'tool_call':
      case 'tool_call_update': {
        if (!prompting() && !native?.observing) return
        const { title, name, kind, status, content, locations, rawInput, rawOutput } = update
        const patch = {
          ...(title != null && { title }),
          ...(name != null && { name }),
          ...(kind != null && { kind }),
          ...(status != null && { status }),
          ...(content != null && { content }),
          ...(locations != null && { locations }),
          ...(rawInput != null && { rawInput }),
          ...(rawOutput != null && { rawOutput })
        }
        if (update.sessionUpdate === 'tool_call' || Object.keys(patch).length) events?.tool(update.toolCallId, patch)
        return
      }
      case 'compaction_update': {
        if (compacting) return
        const { compactionId, status, error } = update
        if (status === 'in_progress') {
          if (compactions.has(compactionId)) return
          compactions.set(compactionId, true)
          if (++activeCompactions === 1) events?.compaction({ type: 'compaction-start' })
        } else if (status === 'completed' || status === 'failed' || status === 'cancelled') {
          const active = compactions.get(compactionId)
          compactions.set(compactionId, false)
          if (active && --activeCompactions === 0) {
            events?.compaction(
              status === 'failed' && error ? { type: 'compaction-error', error } : { type: 'compaction-complete' }
            )
          }
        }
        return
      }
      case 'session_info_update':
        if (update.title?.trim()) events?.title(update.title)
        return
      case 'notice':
        if (update.title.trim())
          events?.notice({
            title: update.title,
            description: update.description ?? undefined,
            severity: update.severity === 'warning' || update.severity === 'error' ? update.severity : 'info'
          })
        return
      case 'usage_update':
        if (!compacting) events?.usage(update)
        return
      case 'available_commands_update':
        events?.commands(
          update.availableCommands.map(({ name, description, input }) => ({
            name,
            description,
            argumentHint: input?.hint ?? ''
          }))
        )
        return
      case 'config_option_update':
        if (controls.acceptOptions(update.configOptions)) publishOptions()
        return
      case 'current_mode_update':
        if (controls.acceptMode(update.currentModeId)) publishOptions()
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
    publishOptions,
    ready() {
      ready = true
      drainNativeTurn()
    },
    drainNativeTurn,
    get awaitingNativeTurn() {
      return native !== undefined && !native.observing
    },
    get busy() {
      return !!compacting || (ready && native !== undefined)
    },
    releaseObserver() {
      events = undefined
      if (native) native.updates.length = 0
    },
    get work() {
      return compacting?.promise ?? native?.done.promise
    },
    close() {
      native?.done.resolve()
      native = undefined
      compacting?.resolve()
      compacting = undefined
      finish()
    },
    harness,
    compact:
      compact &&
      (async () => {
        if (prompting() || compacting || native || controls.busy)
          return {
            status: 'rejected' as const,
            error: { operation: 'compact', code: 'busy', message: 'ACP session is busy' }
          }
        const work = (compacting = Promise.withResolvers<void>())
        try {
          return await compact()
        } finally {
          work.resolve()
          compacting = undefined
          drainNativeTurn()
        }
      })
  }
}
