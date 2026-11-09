import type { UIMessageChunk } from 'ai'

import type { NotifyChannel } from '@main/ai/runtime/agentMcpServers'

import type { AgentRuntimeConnection } from '../runtime/types'

export type AgentSessionTerminalStatus = 'success' | 'paused' | 'error'
export type AgentSessionTerminalOutcome =
  | { status: 'success' }
  | { status: 'paused' }
  | { status: 'error'; error?: unknown }

export type AgentSessionRuntimeAdmissionPhase = 'pending' | 'admitted'
export type AgentSessionRuntimeLaunchTarget<TTurn> = { kind: 'queued-turn' } | { kind: 'reply'; turn: TTurn }
export type AgentSessionRuntimeLaunchState<TTurn> =
  | { kind: 'idle' }
  | { kind: 'scheduled' | 'running' | 'suppressed'; target: AgentSessionRuntimeLaunchTarget<TTurn> }

export interface AgentSessionRuntimeConnectionTarget {
  modelId: string
  reasoningEffort: string
  serviceTier: string
  knowledgeBaseIds: readonly string[]
  /** Formatted source-chat identity for channel-originated sessions; stable within a session. */
  channelContext?: string
  trustedNotifyChannels?: readonly NotifyChannel[]
}

/**
 * Runtime-initiated work occupying the connection, reported by driver edges. Structurally scoped to
 * the `connected` variant: a connection's death erases its occupancy by construction — no cleanup
 * path can forget it.
 */
export interface AgentSessionRuntimeConnectionOccupancy {
  /** Detached tasks keep the connection alive. Deliberately not "busy": user turns may still start. */
  background?: { responder: 'interactive' | 'headless' }
  /** A context rewrite is in flight; it holds the session busy and the topic stream alive. */
  compaction?: true
}

export type AgentSessionRuntimeConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting'; attemptId: string }
  | {
      kind: 'connected'
      connection: AgentRuntimeConnection
      occupancy: AgentSessionRuntimeConnectionOccupancy
      /** A spawn-frozen config mismatch waiting for background occupancy to drain before rebuilding. */
      pendingRebuild?: AgentSessionRuntimeConnectionTarget
    }

export type AgentSessionReplyDelivery =
  | { kind: 'reserved' | 'unopened' | 'attaching' | 'open' | 'suspending' | 'awaiting-persistence' }
  | { kind: 'failed' }
  | { kind: 'settled'; status: AgentSessionTerminalStatus }

export interface AgentSessionRuntimeReply<TTurn> {
  turn: TTurn
  delivery: AgentSessionReplyDelivery
  admission: AgentSessionRuntimeAdmissionPhase
  buffer: UIMessageChunk[]
  terminal?: AgentSessionTerminalOutcome
  pendingResultToolCallIds: readonly string[] | undefined
  deliveryFailure?: { error: unknown }
}

export type AgentSessionRuntimeExecution<TTurn> =
  | { kind: 'idle'; lastTurn?: TTurn }
  | { kind: 'turn'; reply: AgentSessionRuntimeReply<TTurn>; reservation?: TTurn }
  | { kind: 'steer-transition'; source: AgentSessionRuntimeReply<TTurn>; reply: AgentSessionRuntimeReply<TTurn> }
  | {
      kind: 'autonomous-turn'
      reply: AgentSessionRuntimeReply<TTurn>
      deferred?: AgentSessionRuntimeReply<TTurn>
      ownership: 'active' | 'released'
    }

export interface AgentSessionRuntimeState<TTurn, TPendingTurn> {
  execution: AgentSessionRuntimeExecution<TTurn>
  queue: TPendingTurn[]
  launch: AgentSessionRuntimeLaunchState<TTurn>
  connection: AgentSessionRuntimeConnectionState
  lastTerminal?: AgentSessionTerminalStatus
}

export type AgentSessionRuntimeStateEvent<TTurn, TPendingTurn> =
  | { type: 'begin-turn'; turn: TTurn; clearQueue?: boolean; reserved?: boolean }
  | { type: 'queue-turn'; turn: TPendingTurn }
  | { type: 'dequeue-turn' | 'clear-queue' | 'clear-steer-reservation' }
  | { type: 'reserve-steer'; reservation: TTurn }
  | { type: 'steer-boundary'; turn: TTurn }
  | { type: 'autonomous-turn-started'; turn: TTurn; deferCurrentTurn: boolean }
  | { type: 'autonomous-turn-finished' | 'background-reply-resumed' }
  | {
      type:
        | 'turn-suspended'
        | 'turn-prepared'
        | 'turn-stream-attaching'
        | 'turn-stream-opened'
        | 'turn-admitted'
        | 'flush-transition'
      turn: TTurn
    }
  | { type: 'reply-delivery-failed'; turn: TTurn; error: unknown }
  | { type: 'retry-reply'; turn: TTurn }
  | { type: 'buffer-chunk'; turn: TTurn; chunk: UIMessageChunk }
  | { type: 'reply-results'; turn: TTurn; toolCallIds: readonly string[] | undefined }
  | { type: 'runtime-terminal'; turn: TTurn; outcome: AgentSessionTerminalOutcome }
  | { type: 'turn-terminal'; turn: TTurn; status: AgentSessionTerminalStatus }
  | { type: 'launch-started' | 'launch-suppressed' | 'launch-finished'; target: AgentSessionRuntimeLaunchTarget<TTurn> }
  | { type: 'launch-resumed' }
  | {
      type: 'connection-occupancy'
      occupancy: 'background' | 'compaction'
      active: boolean
      responder?: 'interactive' | 'headless'
    }
  | { type: 'connection-started'; attemptId: string }
  | { type: 'connection-connected'; attemptId: string; connection: AgentRuntimeConnection }
  | {
      type: 'connection-rebuild-deferred'
      connection: AgentRuntimeConnection
      target: AgentSessionRuntimeConnectionTarget
    }
  | { type: 'connection-disconnected'; connection?: AgentRuntimeConnection }
  | { type: 'reset' }

export type AgentSessionRuntimeStateEffect<TTurn> =
  | { type: 'schedule-launch'; target: AgentSessionRuntimeLaunchTarget<TTurn> }
  | { type: 'suspend-turn'; turn: TTurn }
  | { type: 'deliver-buffer'; turn: TTurn; chunks: UIMessageChunk[] }
  | { type: 'settle-turn'; turn: TTurn; outcome: AgentSessionTerminalOutcome }
  | { type: 'report-delivery-failure'; turn: TTurn; error: unknown }
  | { type: 'release-background-waiter'; connection?: AgentRuntimeConnection }
  | { type: 'compaction-interrupted' }
  | { type: 'log-invalid-transition'; event: string; state: string }

export interface AgentSessionRuntimeTransition<TTurn, TPendingTurn> {
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
  effects: AgentSessionRuntimeStateEffect<TTurn>[]
}

function reply<TTurn>(
  turn: TTurn,
  delivery: 'reserved' | 'attaching' = 'reserved',
  admission: AgentSessionRuntimeAdmissionPhase = 'admitted'
): AgentSessionRuntimeReply<TTurn> {
  return { turn, delivery: { kind: delivery }, admission, buffer: [], pendingResultToolCallIds: [] }
}

export function createAgentSessionRuntimeState<TTurn, TPendingTurn>(
  turn?: TTurn
): AgentSessionRuntimeState<TTurn, TPendingTurn> {
  return {
    execution: turn ? { kind: 'turn', reply: reply(turn, 'attaching', 'pending') } : { kind: 'idle' },
    queue: [],
    launch: { kind: 'idle' },
    connection: { kind: 'disconnected' }
  }
}

function invalid<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  event: AgentSessionRuntimeStateEvent<TTurn, TPendingTurn>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn> {
  return { state, effects: [{ type: 'log-invalid-transition', event: event.type, state: state.execution.kind }] }
}

function connectionTeardownEffects<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): AgentSessionRuntimeStateEffect<TTurn>[] {
  if (state.connection.kind !== 'connected') return []
  return [
    { type: 'release-background-waiter', connection: state.connection.connection },
    ...(state.connection.occupancy.compaction ? [{ type: 'compaction-interrupted' } as const] : [])
  ]
}

export function getAgentSessionRuntimeReply<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  turn: TTurn
): AgentSessionRuntimeReply<TTurn> | undefined {
  const execution = state.execution
  if (execution.kind === 'idle') return undefined
  if (execution.reply.turn === turn) return execution.reply
  if (execution.kind === 'steer-transition' && execution.source.turn === turn) return execution.source
  if (execution.kind === 'autonomous-turn' && execution.deferred?.turn === turn) return execution.deferred
  return undefined
}

function replaceReply<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  value: AgentSessionRuntimeReply<TTurn>
): AgentSessionRuntimeState<TTurn, TPendingTurn> {
  const execution = state.execution
  if (execution.kind === 'idle') return state
  if (execution.reply.turn === value.turn) return { ...state, execution: { ...execution, reply: value } }
  if (execution.kind === 'steer-transition' && execution.source.turn === value.turn)
    return { ...state, execution: { ...execution, source: value } }
  if (execution.kind === 'autonomous-turn' && execution.deferred?.turn === value.turn)
    return { ...state, execution: { ...execution, deferred: value } }
  return state
}

function advance<TTurn, TPendingTurn>(
  transition: AgentSessionRuntimeTransition<TTurn, TPendingTurn>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn> {
  let { state } = transition
  const effects = [...transition.effects]
  let execution = state.execution
  if (execution.kind === 'steer-transition' && execution.source.delivery.kind === 'settled') {
    execution = { kind: 'turn', reply: execution.reply }
    state = { ...state, execution }
  }
  if (execution.kind !== 'idle' && execution.reply.delivery.kind === 'settled') {
    if (execution.kind === 'turn') {
      state = { ...state, execution: { kind: 'idle', lastTurn: execution.reply.turn } }
    } else if (
      execution.kind === 'autonomous-turn' &&
      execution.ownership === 'released' &&
      execution.deferred?.delivery.kind !== 'suspending'
    ) {
      state = {
        ...state,
        execution:
          execution.deferred && execution.deferred.delivery.kind !== 'settled'
            ? { kind: 'turn', reply: execution.deferred }
            : { kind: 'idle', lastTurn: execution.reply.turn }
      }
    }
  }
  if (state.launch.kind !== 'idle') return { state, effects }
  execution = state.execution
  let target: AgentSessionRuntimeLaunchTarget<TTurn> | undefined
  if (execution.kind === 'idle' && state.queue.length) target = { kind: 'queued-turn' }
  if (
    execution.kind === 'turn' ||
    (execution.kind === 'autonomous-turn' &&
      (!execution.deferred || ['unopened', 'settled'].includes(execution.deferred.delivery.kind)))
  ) {
    if (execution.reply.delivery.kind === 'reserved' || execution.reply.delivery.kind === 'unopened')
      target = { kind: 'reply', turn: execution.reply.turn }
  }
  if (target) {
    state = { ...state, launch: { kind: 'scheduled', target } }
    effects.push({ type: 'schedule-launch', target })
  }
  return { state, effects }
}

export function transitionAgentSessionRuntime<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  event: AgentSessionRuntimeStateEvent<TTurn, TPendingTurn>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn> {
  return advance(reduce(state, event))
}

function reduce<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  event: AgentSessionRuntimeStateEvent<TTurn, TPendingTurn>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn> {
  const execution = state.execution
  switch (event.type) {
    case 'begin-turn':
      if (execution.kind !== 'idle') return invalid(state, event)
      return {
        state: {
          ...state,
          execution: { kind: 'turn', reply: reply(event.turn, event.reserved ? 'reserved' : 'attaching', 'pending') },
          queue: event.clearQueue ? [] : state.queue
        },
        effects: []
      }
    case 'queue-turn':
      return { state: { ...state, queue: [...state.queue, event.turn] }, effects: [] }
    case 'dequeue-turn':
      return { state: { ...state, queue: state.queue.slice(1) }, effects: [] }
    case 'clear-queue':
      return { state: { ...state, queue: [] }, effects: [] }
    case 'reserve-steer':
      if (execution.kind !== 'turn' || execution.reservation) return invalid(state, event)
      return { state: { ...state, execution: { ...execution, reservation: event.reservation } }, effects: [] }
    case 'clear-steer-reservation':
      return execution.kind === 'turn'
        ? { state: { ...state, execution: { kind: 'turn', reply: execution.reply } }, effects: [] }
        : { state, effects: [] }
    case 'steer-boundary': {
      if (execution.kind !== 'turn' && execution.kind !== 'idle') return invalid(state, event)
      const successor = reply(event.turn)
      if (execution.kind === 'idle')
        return { state: { ...state, execution: { kind: 'turn', reply: successor } }, effects: [] }
      const source = execution.reply
      const settle = source.delivery.kind === 'open'
      return {
        state: {
          ...state,
          execution: {
            kind: 'steer-transition',
            source: {
              ...source,
              delivery: source.delivery.kind === 'settled' ? source.delivery : { kind: 'awaiting-persistence' }
            },
            reply: successor
          }
        },
        effects: settle ? [{ type: 'settle-turn', turn: source.turn, outcome: { status: 'success' } }] : []
      }
    }
    case 'background-reply-resumed': {
      if (
        execution.kind === 'idle' ||
        execution.kind === 'steer-transition' ||
        !['open', 'attaching', 'unopened'].includes(execution.reply.delivery.kind)
      )
        return invalid(state, event)
      const resumed = { ...execution, reply: { ...execution.reply, terminal: undefined } }
      return {
        state: {
          ...state,
          execution: resumed.kind === 'autonomous-turn' ? { ...resumed, ownership: 'active' } : resumed
        },
        effects: []
      }
    }
    case 'autonomous-turn-started': {
      if (execution.kind === 'autonomous-turn') return { state, effects: [] }
      if (execution.kind === 'steer-transition') return invalid(state, event)
      const deferred =
        event.deferCurrentTurn && execution.kind === 'turn'
          ? execution.reply.delivery.kind === 'awaiting-persistence'
            ? execution.reply
            : { ...execution.reply, delivery: { kind: 'suspending' } as const }
          : undefined
      return {
        state: {
          ...state,
          execution: { kind: 'autonomous-turn', reply: reply(event.turn), deferred, ownership: 'active' }
        },
        effects: deferred?.delivery.kind === 'suspending' ? [{ type: 'suspend-turn', turn: deferred.turn }] : []
      }
    }
    case 'autonomous-turn-finished': {
      if (execution.kind !== 'autonomous-turn' || execution.ownership === 'released') return { state, effects: [] }
      const current = execution.reply
      return {
        state: {
          ...state,
          execution: {
            ...execution,
            ownership: 'released',
            reply: current.delivery.kind === 'failed' ? { ...current, delivery: { kind: 'reserved' } } : current
          }
        },
        effects: []
      }
    }
    case 'turn-suspended': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'suspending') return { state, effects: [] }
      return { state: replaceReply(state, { ...current, delivery: { kind: 'unopened' } }), effects: [] }
    }
    case 'retry-reply': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'failed') return { state, effects: [] }
      return { state: replaceReply(state, { ...current, delivery: { kind: 'reserved' } }), effects: [] }
    }
    case 'turn-prepared': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'reserved') return { state, effects: [] }
      return { state: replaceReply(state, { ...current, delivery: { kind: 'unopened' } }), effects: [] }
    }
    case 'reply-delivery-failed': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current || current.delivery.kind === 'settled') return { state, effects: [] }
      if (current.admission === 'pending' && execution.kind === 'turn') {
        return {
          state: { ...state, execution: { kind: 'idle', lastTurn: event.turn }, queue: [], lastTerminal: 'error' },
          effects: [{ type: 'report-delivery-failure', turn: event.turn, error: event.error }]
        }
      }
      return {
        state: replaceReply(state, {
          ...current,
          delivery: { kind: 'failed' },
          deliveryFailure: { error: event.error }
        }),
        effects: [{ type: 'report-delivery-failure', turn: event.turn, error: event.error }]
      }
    }
    case 'turn-stream-attaching': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'unopened') return invalid(state, event)
      return { state: replaceReply(state, { ...current, delivery: { kind: 'attaching' } }), effects: [] }
    }
    case 'turn-stream-opened': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'attaching' && current?.delivery.kind !== 'unopened') return invalid(state, event)
      return { state: replaceReply(state, { ...current, delivery: { kind: 'open' } }), effects: [] }
    }
    case 'turn-admitted': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current) return invalid(state, event)
      return { state: replaceReply(state, { ...current, admission: 'admitted' }), effects: [] }
    }
    case 'buffer-chunk': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current || current.delivery.kind === 'settled') return { state, effects: [] }
      return { state: replaceReply(state, { ...current, buffer: [...current.buffer, event.chunk] }), effects: [] }
    }
    case 'reply-results': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current || current.delivery.kind === 'settled' || current.delivery.kind === 'awaiting-persistence')
        return { state, effects: [] }
      const updated = replaceReply(state, { ...current, pendingResultToolCallIds: event.toolCallIds })
      return event.toolCallIds?.length === 0 && current.terminal
        ? transitionAgentSessionRuntime(updated, {
            type: 'runtime-terminal',
            turn: event.turn,
            outcome: current.terminal
          })
        : { state: updated, effects: [] }
    }
    case 'runtime-terminal': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current || current.delivery.kind === 'settled' || current.delivery.kind === 'awaiting-persistence')
        return { state, effects: [] }
      const terminal = current.terminal && current.terminal.status !== 'success' ? current.terminal : event.outcome
      if (current.delivery.kind === 'failed') {
        const retry = execution.kind !== 'autonomous-turn' || execution.ownership === 'released'
        return {
          state: replaceReply(state, {
            ...current,
            terminal,
            ...(retry ? { delivery: { kind: 'reserved' } as const } : {})
          }),
          effects: []
        }
      }
      const held = terminal.status === 'success' && current.pendingResultToolCallIds?.length !== 0
      const settle = current.delivery.kind === 'open' && !held
      return {
        state: replaceReply(state, {
          ...current,
          terminal,
          ...(settle ? { delivery: { kind: 'awaiting-persistence' } as const } : {})
        }),
        effects: settle
          ? [
              {
                type: 'settle-turn',
                turn: current.turn,
                outcome: current.deliveryFailure ? { status: 'error', error: current.deliveryFailure.error } : terminal
              }
            ]
          : []
      }
    }
    case 'flush-transition': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (current?.delivery.kind !== 'open') return { state, effects: [] }
      const held = current.terminal?.status === 'success' && current.pendingResultToolCallIds?.length !== 0
      const terminal =
        !held && current.terminal
          ? current.deliveryFailure
            ? { status: 'error' as const, error: current.deliveryFailure.error }
            : current.terminal
          : undefined
      return {
        state: replaceReply(state, {
          ...current,
          buffer: [],
          ...(terminal ? { delivery: { kind: 'awaiting-persistence' } as const } : {})
        }),
        effects: [
          ...(current.buffer.length
            ? [{ type: 'deliver-buffer', turn: current.turn, chunks: current.buffer } as const]
            : []),
          ...(terminal ? [{ type: 'settle-turn', turn: current.turn, outcome: terminal } as const] : [])
        ]
      }
    }
    case 'turn-terminal': {
      const current = getAgentSessionRuntimeReply(state, event.turn)
      if (!current || current.delivery.kind === 'settled' || current.delivery.kind === 'suspending')
        return { state, effects: [] }
      return {
        state: {
          ...replaceReply(state, { ...current, delivery: { kind: 'settled', status: event.status } }),
          lastTerminal: event.status
        },
        effects: []
      }
    }
    case 'launch-started':
    case 'launch-suppressed':
      if (state.launch.kind !== 'scheduled' || state.launch.target !== event.target) return { state, effects: [] }
      return {
        state: {
          ...state,
          launch: { kind: event.type === 'launch-started' ? 'running' : 'suppressed', target: event.target }
        },
        effects: []
      }
    case 'launch-finished':
      if (state.launch.kind === 'idle' || state.launch.target !== event.target) return { state, effects: [] }
      return { state: { ...state, launch: { kind: 'idle' } }, effects: [] }
    case 'launch-resumed':
      if (state.launch.kind !== 'suppressed') return { state, effects: [] }
      return {
        state: { ...state, launch: { kind: 'scheduled', target: state.launch.target } },
        effects: [{ type: 'schedule-launch', target: state.launch.target }]
      }
    case 'connection-occupancy': {
      const connection = state.connection
      if (connection.kind !== 'connected') {
        // A cleared occupancy is already structurally gone with the connection; only an activation
        // without a connection is a protocol violation worth logging.
        return event.active ? invalid(state, event) : { state, effects: [] }
      }
      if (event.occupancy === 'compaction') {
        if (event.active === (connection.occupancy.compaction === true)) return { state, effects: [] }
        const occupancy = { ...connection.occupancy }
        if (event.active) occupancy.compaction = true
        else delete occupancy.compaction
        return { state: { ...state, connection: { ...connection, occupancy } }, effects: [] }
      }
      if (event.active) {
        const updated: AgentSessionRuntimeState<TTurn, TPendingTurn> = {
          ...state,
          connection: {
            ...connection,
            occupancy: {
              ...connection.occupancy,
              background: {
                responder: connection.occupancy.background?.responder ?? event.responder ?? 'headless'
              }
            }
          }
        }
        return { state: updated, effects: [] }
      }
      if (!connection.occupancy.background) return { state, effects: [] }
      const occupancy = { ...connection.occupancy }
      delete occupancy.background
      // Draining background work also releases any rebuild it was blocking.
      const released: AgentSessionRuntimeState<TTurn, TPendingTurn> = {
        ...state,
        connection: { kind: 'connected', connection: connection.connection, occupancy }
      }
      return {
        state: released,
        effects: [{ type: 'release-background-waiter', connection: connection.connection }]
      }
    }
    case 'connection-started':
      if (state.connection.kind !== 'disconnected') return invalid(state, event)
      return {
        state: { ...state, connection: { kind: 'connecting', attemptId: event.attemptId } },
        effects: []
      }
    case 'connection-connected':
      if (state.connection.kind !== 'connecting' || state.connection.attemptId !== event.attemptId) {
        return invalid(state, event)
      }
      return {
        state: { ...state, connection: { kind: 'connected', connection: event.connection, occupancy: {} } },
        effects: []
      }
    case 'connection-rebuild-deferred':
      if (
        state.connection.kind !== 'connected' ||
        state.connection.connection !== event.connection ||
        !state.connection.occupancy.background
      ) {
        return invalid(state, event)
      }
      return {
        state: {
          ...state,
          connection: { ...state.connection, pendingRebuild: event.target }
        },
        effects: []
      }
    case 'connection-disconnected': {
      if (
        event.connection &&
        state.connection.kind === 'connected' &&
        state.connection.connection !== event.connection
      ) {
        return invalid(state, event)
      }
      return {
        state: { ...state, connection: { kind: 'disconnected' } },
        effects: connectionTeardownEffects(state)
      }
    }
    case 'reset':
      return {
        state: {
          ...createAgentSessionRuntimeState<TTurn, TPendingTurn>(),
          ...(state.lastTerminal ? { lastTerminal: state.lastTerminal } : {})
        },
        effects: connectionTeardownEffects(state)
      }
  }
}

export function getAgentSessionRuntimeCurrentTurn<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): TTurn | undefined {
  return state.execution.kind === 'idle' ? state.execution.lastTurn : state.execution.reply.turn
}

/** A released native generation may already be producing the suspended admitted reply. */
export function getAgentSessionRuntimeNativeTurn<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): TTurn | undefined {
  const execution = state.execution
  if (execution.kind === 'idle') return undefined
  if (
    execution.kind === 'autonomous-turn' &&
    execution.ownership === 'released' &&
    execution.reply.terminal !== undefined &&
    execution.deferred?.admission === 'admitted' &&
    !execution.deferred.terminal
  )
    return execution.deferred.turn
  return execution.reply.turn
}

export function getAgentSessionRuntimeTurns<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): TTurn[] {
  const execution = state.execution
  if (execution.kind === 'idle') return []
  return [
    execution.reply.turn,
    ...(execution.kind === 'steer-transition' ? [execution.source.turn] : []),
    ...(execution.kind === 'autonomous-turn' && execution.deferred ? [execution.deferred.turn] : [])
  ]
}

export function isAgentSessionRuntimeTurnLive<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  turn: TTurn
): boolean {
  const current = getAgentSessionRuntimeReply(state, turn)
  return !!current && current.delivery.kind !== 'settled' && current.delivery.kind !== 'awaiting-persistence'
}

export function getAgentSessionRuntimeLiveTurn<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): TTurn | undefined {
  const turn = getAgentSessionRuntimeCurrentTurn(state)
  return turn !== undefined && isAgentSessionRuntimeTurnLive(state, turn) ? turn : undefined
}

export function getAgentSessionRuntimeConnection<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): AgentRuntimeConnection | undefined {
  return state.connection.kind === 'connected' ? state.connection.connection : undefined
}

export function getAgentSessionRuntimeOccupancy<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): AgentSessionRuntimeConnectionOccupancy | undefined {
  return state.connection.kind === 'connected' ? state.connection.occupancy : undefined
}

export function hasAgentSessionRuntimeBackgroundWork<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return getAgentSessionRuntimeOccupancy(state)?.background !== undefined
}

export function isAgentSessionRuntimeCompacting<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return getAgentSessionRuntimeOccupancy(state)?.compaction === true
}

export function isAgentSessionRuntimeTransitioning<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return (
    state.execution.kind === 'steer-transition' ||
    state.execution.kind === 'autonomous-turn' ||
    (state.execution.kind === 'turn' && state.execution.reply.delivery.kind === 'awaiting-persistence')
  )
}

export function isAgentSessionRuntimeAutonomous<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return state.execution.kind === 'autonomous-turn' && state.execution.ownership === 'active'
}

export function isAgentSessionRuntimeTurnAdmitted<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  turn: TTurn
): boolean {
  return getAgentSessionRuntimeReply(state, turn)?.admission === 'admitted'
}

export function hasAgentSessionRuntimeOpenStream<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>,
  turn = getAgentSessionRuntimeCurrentTurn(state)
): boolean {
  return turn !== undefined && getAgentSessionRuntimeReply(state, turn)?.delivery.kind === 'open'
}

export function isAgentSessionRuntimeBusy<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return (
    isAgentSessionRuntimeCompacting(state) ||
    state.launch.kind !== 'idle' ||
    state.queue.length > 0 ||
    state.execution.kind !== 'idle'
  )
}

export function willAgentSessionRuntimeContinue<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return (
    isAgentSessionRuntimeCompacting(state) ||
    state.queue.length > 0 ||
    state.launch.kind !== 'idle' ||
    state.execution.kind === 'steer-transition' ||
    (state.execution.kind === 'autonomous-turn' && state.execution.deferred !== undefined)
  )
}

export function isAgentSessionRuntimeAwaitingBackground<TTurn, TPendingTurn>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn>
): boolean {
  return (
    (state.execution.kind === 'turn' || state.execution.kind === 'autonomous-turn') &&
    ['open', 'attaching', 'unopened'].includes(state.execution.reply.delivery.kind) &&
    state.execution.reply.terminal?.status === 'success' &&
    state.execution.reply.pendingResultToolCallIds?.length !== 0
  )
}
