import type { UIMessageChunk } from 'ai'

import type { AgentRuntimeConnection, AgentRuntimeUserInput } from '../runtime/types'

export type AgentSessionTerminalStatus = 'success' | 'paused' | 'error'
export type AgentSessionTerminalOutcome =
  | { status: 'success' }
  | { status: 'paused' }
  | { status: 'error'; error?: unknown }

export type AgentSessionRuntimeStreamPhase = 'unopened' | 'open' | 'awaiting-persistence' | 'settled'
export type AgentSessionRuntimeAdmissionPhase = 'pending' | 'admitted'

export type AgentSessionRuntimeLaunchTarget = 'queued-turn' | 'steer-continuation' | 'receive-only' | 'deferred-turn'

export type AgentSessionRuntimeLaunchState =
  | { kind: 'idle' }
  | { kind: 'scheduled'; target: AgentSessionRuntimeLaunchTarget }
  | { kind: 'running'; target: AgentSessionRuntimeLaunchTarget }
  | { kind: 'suppressed'; target: AgentSessionRuntimeLaunchTarget }

export interface AgentSessionRuntimeConnectionTarget {
  modelId: string
  reasoningEffort: string
  serviceTier: string
  knowledgeBaseIds: readonly string[]
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

export type AgentSessionRuntimeExecution<TTurn, TReservation> =
  | { kind: 'idle'; lastTurn?: TTurn }
  | {
      kind: 'turn'
      turn: TTurn
      stream: AgentSessionRuntimeStreamPhase
      admission: AgentSessionRuntimeAdmissionPhase
      reservation?: TReservation
      terminal?: AgentSessionTerminalOutcome
    }
  | {
      kind: 'steer-transition'
      sourceTurn: TTurn
      sourceStream: 'awaiting-persistence' | 'settled'
      continuationTurn?: TTurn
      inputs: AgentRuntimeUserInput[]
      headless: boolean
      reservation?: TReservation
      buffer: UIMessageChunk[]
      stream: AgentSessionRuntimeStreamPhase
      terminal?: AgentSessionTerminalOutcome
    }
  | {
      kind: 'autonomous-turn'
      turn?: TTurn
      contextTurn?: TTurn
      deferredTurn?: TTurn
      ownership: 'active' | 'released'
      buffer: UIMessageChunk[]
      stream: AgentSessionRuntimeStreamPhase
      terminal?: AgentSessionTerminalOutcome
      settled?: AgentSessionTerminalStatus
    }

export interface AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation> {
  execution: AgentSessionRuntimeExecution<TTurn, TReservation>
  queue: TPendingTurn[]
  launch: AgentSessionRuntimeLaunchState
  connection: AgentSessionRuntimeConnectionState
  /** Persistence-confirmed status of the most recently settled turn. Survives `reset`. */
  lastTerminal?: AgentSessionTerminalStatus
}

export type AgentSessionRuntimeStateEvent<TTurn, TPendingTurn, TReservation> =
  | {
      type: 'begin-turn'
      turn: TTurn
      clearQueue?: boolean
      stream?: AgentSessionRuntimeStreamPhase
      admission?: AgentSessionRuntimeAdmissionPhase
    }
  | { type: 'queue-turn'; turn: TPendingTurn }
  | { type: 'dequeue-turn' }
  | { type: 'clear-queue' }
  | { type: 'reserve-steer'; reservation: TReservation }
  | { type: 'clear-steer-reservation' }
  | { type: 'steer-boundary'; inputs: AgentRuntimeUserInput[]; headless: boolean }
  | {
      type: 'autonomous-turn-state'
      state: 'started' | 'finished'
      deferCurrentTurn?: boolean
      contextTurn?: TTurn
    }
  | { type: 'autonomous-turn-abandoned' }
  | { type: 'autonomous-turn-created'; turn: TTurn }
  | { type: 'continuation-turn-created'; turn: TTurn }
  | { type: 'turn-stream-opened'; turn: TTurn }
  | { type: 'turn-admitted'; turn: TTurn }
  | { type: 'buffer-chunk'; chunk: UIMessageChunk }
  | { type: 'runtime-terminal'; outcome: AgentSessionTerminalOutcome }
  | { type: 'flush-transition' }
  | { type: 'turn-terminal'; turn: TTurn; status: AgentSessionTerminalStatus }
  | { type: 'launch-requested'; target: AgentSessionRuntimeLaunchTarget }
  | { type: 'launch-started'; target: AgentSessionRuntimeLaunchTarget }
  | { type: 'launch-suppressed'; target: AgentSessionRuntimeLaunchTarget }
  | { type: 'launch-finished'; target: AgentSessionRuntimeLaunchTarget }
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
  | { type: 'schedule-launch'; target: AgentSessionRuntimeLaunchTarget }
  | { type: 'deliver-buffer'; turn: TTurn; chunks: UIMessageChunk[] }
  | { type: 'settle-turn'; turn: TTurn; outcome: AgentSessionTerminalOutcome }
  | { type: 'release-background-waiter'; connection?: AgentRuntimeConnection }
  /** A connection died while a compaction occupied it — its projected status must leave `compacting`. */
  | { type: 'compaction-interrupted' }
  | { type: 'log-invalid-transition'; event: string; state: string }

export interface AgentSessionRuntimeTransition<TTurn, TPendingTurn, TReservation> {
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
  effects: AgentSessionRuntimeStateEffect<TTurn>[]
}

export function createAgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>(
  turn?: TTurn
): AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation> {
  return {
    execution: turn ? { kind: 'turn', turn, stream: 'unopened', admission: 'pending' } : { kind: 'idle' },
    queue: [],
    launch: { kind: 'idle' },
    connection: { kind: 'disconnected' }
  }
}

function invalid<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  event: AgentSessionRuntimeStateEvent<TTurn, TPendingTurn, TReservation>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn, TReservation> {
  return {
    state,
    effects: [{ type: 'log-invalid-transition', event: event.type, state: state.execution.kind }]
  }
}

/** Occupancy dies with its connection; these effects hand the interruption to the host. */
function connectionTeardownEffects<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): AgentSessionRuntimeStateEffect<TTurn>[] {
  if (state.connection.kind !== 'connected') return []
  return [
    { type: 'release-background-waiter', connection: state.connection.connection },
    ...(state.connection.occupancy.compaction ? [{ type: 'compaction-interrupted' } as const] : [])
  ]
}

function resumeAfterAutonomous<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  execution: Extract<AgentSessionRuntimeExecution<TTurn, TReservation>, { kind: 'autonomous-turn' }>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn, TReservation> {
  if (!execution.settled || execution.ownership === 'active') return { state: { ...state, execution }, effects: [] }
  if (execution.deferredTurn) {
    const canSchedule = state.launch.kind === 'idle'
    return {
      state: {
        ...state,
        execution: {
          kind: 'turn',
          turn: execution.deferredTurn,
          stream: 'unopened',
          admission: 'pending'
        },
        launch: canSchedule ? { kind: 'scheduled', target: 'deferred-turn' } : state.launch,
        lastTerminal: execution.settled
      },
      effects: canSchedule ? [{ type: 'schedule-launch', target: 'deferred-turn' }] : []
    }
  }
  return {
    state: {
      ...state,
      execution: {
        kind: 'idle',
        ...(execution.turn || execution.contextTurn ? { lastTurn: execution.turn ?? execution.contextTurn } : {})
      },
      lastTerminal: execution.settled
    },
    effects: []
  }
}

export function transitionAgentSessionRuntime<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  event: AgentSessionRuntimeStateEvent<TTurn, TPendingTurn, TReservation>
): AgentSessionRuntimeTransition<TTurn, TPendingTurn, TReservation> {
  switch (event.type) {
    case 'begin-turn':
      if (state.execution.kind !== 'idle') return invalid(state, event)
      return {
        state: {
          ...state,
          execution: {
            kind: 'turn',
            turn: event.turn,
            stream: event.stream ?? 'unopened',
            admission: event.admission ?? 'pending'
          },
          queue: event.clearQueue ? [] : state.queue
        },
        effects: []
      }
    case 'queue-turn':
      return { state: { ...state, queue: [...state.queue, event.turn] }, effects: [] }
    case 'dequeue-turn':
      return state.queue.length > 0
        ? { state: { ...state, queue: state.queue.slice(1) }, effects: [] }
        : invalid(state, event)
    case 'clear-queue':
      return state.queue.length > 0 ? { state: { ...state, queue: [] }, effects: [] } : { state, effects: [] }
    case 'reserve-steer':
      if (state.execution.kind !== 'turn' || state.execution.reservation) return invalid(state, event)
      return {
        state: { ...state, execution: { ...state.execution, reservation: event.reservation } },
        effects: []
      }
    case 'clear-steer-reservation':
      if (state.execution.kind === 'turn' && state.execution.reservation) {
        const { turn, stream, admission, terminal } = state.execution
        const execution: AgentSessionRuntimeExecution<TTurn, TReservation> = {
          kind: 'turn',
          turn,
          stream,
          admission,
          ...(terminal ? { terminal } : {})
        }
        return { state: { ...state, execution }, effects: [] }
      }
      return { state, effects: [] }
    case 'steer-boundary':
      if (state.execution.kind !== 'turn' || state.execution.stream !== 'open') return invalid(state, event)
      return {
        state: {
          ...state,
          execution: {
            kind: 'steer-transition',
            sourceTurn: state.execution.turn,
            sourceStream: 'awaiting-persistence',
            inputs: event.inputs,
            headless: event.headless,
            ...(state.execution.reservation ? { reservation: state.execution.reservation } : {}),
            buffer: [],
            stream: 'unopened'
          }
        },
        effects: [{ type: 'settle-turn', turn: state.execution.turn, outcome: { status: 'success' } }]
      }
    case 'autonomous-turn-state': {
      if (event.state === 'started') {
        if (state.execution.kind === 'autonomous-turn') return { state, effects: [] }
        if (state.execution.kind === 'steer-transition') return invalid(state, event)
        const deferredTurn =
          event.deferCurrentTurn && state.execution.kind === 'turn' ? state.execution.turn : undefined
        return {
          state: {
            ...state,
            execution: {
              kind: 'autonomous-turn',
              ...(event.contextTurn ? { contextTurn: event.contextTurn } : {}),
              ...(deferredTurn ? { deferredTurn } : {}),
              ownership: 'active',
              buffer: [],
              stream: 'unopened'
            }
          },
          effects: []
        }
      }
      if (state.execution.kind !== 'autonomous-turn') return { state, effects: [] }
      return resumeAfterAutonomous(state, { ...state.execution, ownership: 'released' })
    }
    case 'autonomous-turn-abandoned': {
      if (state.execution.kind !== 'autonomous-turn') return invalid(state, event)
      return {
        state: {
          ...state,
          execution: state.execution.deferredTurn
            ? {
                kind: 'turn',
                turn: state.execution.deferredTurn,
                stream: 'unopened',
                admission: 'pending'
              }
            : { kind: 'idle', ...(state.execution.contextTurn ? { lastTurn: state.execution.contextTurn } : {}) }
        },
        effects: []
      }
    }
    case 'autonomous-turn-created':
      if (state.execution.kind !== 'autonomous-turn' || state.execution.turn) return invalid(state, event)
      return {
        state: { ...state, execution: { ...state.execution, turn: event.turn } },
        effects: []
      }
    case 'continuation-turn-created':
      if (state.execution.kind !== 'steer-transition' || state.execution.continuationTurn) {
        return invalid(state, event)
      }
      return {
        state: { ...state, execution: { ...state.execution, continuationTurn: event.turn } },
        effects: []
      }
    case 'turn-stream-opened': {
      const execution = state.execution
      if (execution.kind === 'turn' && execution.turn === event.turn && execution.stream === 'unopened') {
        return { state: { ...state, execution: { ...execution, stream: 'open' } }, effects: [] }
      }
      if (
        execution.kind === 'steer-transition' &&
        execution.continuationTurn === event.turn &&
        execution.stream === 'unopened'
      ) {
        return { state: { ...state, execution: { ...execution, stream: 'open' } }, effects: [] }
      }
      if (execution.kind === 'autonomous-turn' && execution.turn === event.turn && execution.stream === 'unopened') {
        return { state: { ...state, execution: { ...execution, stream: 'open' } }, effects: [] }
      }
      return invalid(state, event)
    }
    case 'turn-admitted':
      if (state.execution.kind !== 'turn' || state.execution.turn !== event.turn) return invalid(state, event)
      if (state.execution.admission === 'admitted') return { state, effects: [] }
      return {
        state: { ...state, execution: { ...state.execution, admission: 'admitted' } },
        effects: []
      }
    case 'buffer-chunk':
      if (
        (state.execution.kind !== 'steer-transition' && state.execution.kind !== 'autonomous-turn') ||
        state.execution.stream !== 'unopened' ||
        state.execution.terminal
      ) {
        return invalid(state, event)
      }
      return {
        state: {
          ...state,
          execution: { ...state.execution, buffer: [...state.execution.buffer, event.chunk] }
        },
        effects: []
      }
    case 'runtime-terminal': {
      const execution = state.execution
      if (execution.kind === 'turn') {
        if (execution.stream === 'unopened') {
          if (execution.terminal) return { state, effects: [] }
          return {
            state: { ...state, execution: { ...execution, terminal: event.outcome } },
            effects: []
          }
        }
        if (execution.stream === 'open') {
          return {
            state: { ...state, execution: { ...execution, stream: 'awaiting-persistence' } },
            effects: [{ type: 'settle-turn', turn: execution.turn, outcome: event.outcome }]
          }
        }
        return { state, effects: [] }
      }
      if (execution.kind === 'steer-transition') {
        if (execution.stream === 'unopened') {
          if (execution.terminal) return { state, effects: [] }
          return {
            state: { ...state, execution: { ...execution, terminal: event.outcome } },
            effects: []
          }
        }
        if (execution.stream === 'open' && execution.continuationTurn) {
          return {
            state: { ...state, execution: { ...execution, stream: 'awaiting-persistence' } },
            effects: [{ type: 'settle-turn', turn: execution.continuationTurn, outcome: event.outcome }]
          }
        }
        return { state, effects: [] }
      }
      if (execution.kind === 'autonomous-turn') {
        if (execution.stream === 'unopened') {
          if (execution.terminal) return { state, effects: [] }
          return resumeAfterAutonomous(state, { ...execution, terminal: event.outcome })
        }
        if (execution.stream === 'open' && execution.turn) {
          return {
            state: { ...state, execution: { ...execution, stream: 'awaiting-persistence' } },
            effects: [{ type: 'settle-turn', turn: execution.turn, outcome: event.outcome }]
          }
        }
        return { state, effects: [] }
      }
      return invalid(state, event)
    }
    case 'flush-transition': {
      const execution = state.execution
      if (execution.kind === 'turn') {
        if (execution.stream !== 'open' || !execution.terminal) return { state, effects: [] }
        return {
          state: {
            ...state,
            execution: {
              kind: 'turn',
              turn: execution.turn,
              stream: 'awaiting-persistence',
              admission: execution.admission,
              ...(execution.reservation ? { reservation: execution.reservation } : {})
            }
          },
          effects: [{ type: 'settle-turn', turn: execution.turn, outcome: execution.terminal }]
        }
      }
      if (execution.kind === 'steer-transition') {
        if (!execution.continuationTurn || execution.sourceStream !== 'settled' || execution.stream !== 'open') {
          return invalid(state, event)
        }
        return {
          state: {
            ...state,
            execution: {
              kind: 'turn',
              turn: execution.continuationTurn,
              stream: execution.terminal ? 'awaiting-persistence' : 'open',
              admission: 'admitted'
            }
          },
          effects: [
            { type: 'deliver-buffer', turn: execution.continuationTurn, chunks: execution.buffer },
            ...(execution.terminal
              ? [{ type: 'settle-turn', turn: execution.continuationTurn, outcome: execution.terminal } as const]
              : [])
          ]
        }
      }
      if (execution.kind === 'autonomous-turn' && execution.turn && execution.stream === 'open') {
        return {
          state: {
            ...state,
            execution: {
              ...execution,
              buffer: [],
              stream: execution.terminal ? 'awaiting-persistence' : 'open',
              terminal: undefined
            }
          },
          effects: [
            { type: 'deliver-buffer', turn: execution.turn, chunks: execution.buffer },
            ...(execution.terminal
              ? [{ type: 'settle-turn', turn: execution.turn, outcome: execution.terminal } as const]
              : [])
          ]
        }
      }
      return { state, effects: [] }
    }
    case 'turn-terminal': {
      const execution = state.execution
      if (execution.kind === 'steer-transition' && execution.sourceTurn === event.turn) {
        if (event.status === 'success') {
          if (execution.sourceStream === 'settled') return { state, effects: [] }
          return {
            state: {
              ...state,
              execution: { ...execution, sourceStream: 'settled' },
              launch: { kind: 'scheduled', target: 'steer-continuation' },
              lastTerminal: event.status
            },
            effects: [{ type: 'schedule-launch', target: 'steer-continuation' }]
          }
        }
        return {
          state: { ...state, execution: { kind: 'idle', lastTurn: event.turn }, lastTerminal: event.status },
          effects: []
        }
      }
      if (execution.kind === 'autonomous-turn' && execution.turn === event.turn) {
        return resumeAfterAutonomous(state, {
          ...execution,
          stream: 'settled',
          settled: event.status
        })
      }
      if (execution.kind === 'turn' && execution.turn === event.turn) {
        return {
          state: { ...state, execution: { kind: 'idle', lastTurn: event.turn }, lastTerminal: event.status },
          effects: []
        }
      }
      // An already-idle execution can still receive a terminal report (e.g. a launch failed before
      // its turn existed). Record the status; there is no execution to transition.
      if (execution.kind === 'idle') {
        return { state: { ...state, lastTerminal: event.status }, effects: [] }
      }
      return invalid(state, event)
    }
    case 'launch-requested':
      if (state.launch.kind !== 'idle') return { state, effects: [] }
      return {
        state: { ...state, launch: { kind: 'scheduled', target: event.target } },
        effects: [{ type: 'schedule-launch', target: event.target }]
      }
    case 'launch-started':
      if (state.launch.kind !== 'scheduled' || state.launch.target !== event.target) return invalid(state, event)
      return { state: { ...state, launch: { kind: 'running', target: event.target } }, effects: [] }
    case 'launch-suppressed':
      if (state.launch.kind !== 'scheduled' || state.launch.target !== event.target) return invalid(state, event)
      return { state: { ...state, launch: { kind: 'suppressed', target: event.target } }, effects: [] }
    case 'launch-finished':
      if (state.launch.kind === 'idle' || state.launch.target !== event.target) return invalid(state, event)
      return { state: { ...state, launch: { kind: 'idle' } }, effects: [] }
    case 'launch-resumed':
      if (state.launch.kind !== 'suppressed') return invalid(state, event)
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
        // Keep the first responder for the whole occupancy — a later edge cannot relax it.
        if (connection.occupancy.background) return { state, effects: [] }
        return {
          state: {
            ...state,
            connection: {
              ...connection,
              occupancy: { ...connection.occupancy, background: { responder: event.responder ?? 'headless' } }
            }
          },
          effects: []
        }
      }
      if (!connection.occupancy.background) return { state, effects: [] }
      const occupancy = { ...connection.occupancy }
      delete occupancy.background
      // Draining background work also releases any rebuild it was blocking.
      return {
        state: { ...state, connection: { kind: 'connected', connection: connection.connection, occupancy } },
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
          ...createAgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>(),
          ...(state.lastTerminal ? { lastTerminal: state.lastTerminal } : {})
        },
        effects: [
          {
            type: 'release-background-waiter',
            connection: state.connection.kind === 'connected' ? state.connection.connection : undefined
          },
          ...(state.connection.kind === 'connected' && state.connection.occupancy.compaction
            ? [{ type: 'compaction-interrupted' } as const]
            : [])
        ]
      }
  }
}

export function getAgentSessionRuntimeCurrentTurn<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): TTurn | undefined {
  switch (state.execution.kind) {
    case 'turn':
      return state.execution.turn
    case 'steer-transition':
      return state.execution.continuationTurn ?? state.execution.sourceTurn
    case 'autonomous-turn':
      return state.execution.turn
    case 'idle':
      return state.execution.lastTurn
  }
}

/**
 * Machine-derived turn liveness — the single source of truth. A turn is live until its `settle-turn`
 * effect has been issued (stream left `unopened`/`open`) or it is no longer referenced by the
 * execution. A merely *recorded* terminal outcome (`execution.terminal` latched while the stream is
 * still unopened) keeps the turn live: its stream must still open so the outcome can flush into it.
 */
export function isAgentSessionRuntimeTurnLive<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  turn: TTurn
): boolean {
  const execution = state.execution
  switch (execution.kind) {
    case 'idle':
      return false
    case 'turn':
      return execution.turn === turn && (execution.stream === 'unopened' || execution.stream === 'open')
    case 'steer-transition':
      // The source turn settled at the boundary; only the continuation can still be live.
      return execution.continuationTurn === turn && (execution.stream === 'unopened' || execution.stream === 'open')
    case 'autonomous-turn':
      // A deferred turn is parked, not settled — it will run once the generation releases.
      if (execution.deferredTurn === turn) return true
      return execution.turn === turn && (execution.stream === 'unopened' || execution.stream === 'open')
  }
}

export function getAgentSessionRuntimeLiveTurn<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): TTurn | undefined {
  const turn = getAgentSessionRuntimeCurrentTurn(state)
  return turn !== undefined && isAgentSessionRuntimeTurnLive(state, turn) ? turn : undefined
}

export function getAgentSessionRuntimeConnection<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): AgentRuntimeConnection | undefined {
  return state.connection.kind === 'connected' ? state.connection.connection : undefined
}

export function getAgentSessionRuntimeOccupancy<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): AgentSessionRuntimeConnectionOccupancy | undefined {
  return state.connection.kind === 'connected' ? state.connection.occupancy : undefined
}

export function hasAgentSessionRuntimeBackgroundWork<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return getAgentSessionRuntimeOccupancy(state)?.background !== undefined
}

export function isAgentSessionRuntimeCompacting<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return getAgentSessionRuntimeOccupancy(state)?.compaction === true
}

export function isAgentSessionRuntimeTransitioning<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return (
    state.execution.kind === 'steer-transition' ||
    state.execution.kind === 'autonomous-turn' ||
    (state.execution.kind === 'turn' && state.execution.stream === 'awaiting-persistence')
  )
}

export function isAgentSessionRuntimeAutonomous<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return state.execution.kind === 'autonomous-turn' && state.execution.ownership === 'active'
}

export function isAgentSessionRuntimeTurnAdmitted<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  turn: TTurn
): boolean {
  const execution = state.execution
  if (execution.kind === 'turn') return execution.turn === turn && execution.admission === 'admitted'
  if (execution.kind === 'steer-transition') {
    return execution.sourceTurn === turn || execution.continuationTurn === turn
  }
  return execution.kind === 'autonomous-turn' && execution.turn === turn
}

export function hasAgentSessionRuntimeOpenStream<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  turn?: TTurn
): boolean {
  const execution = state.execution
  if (execution.kind === 'turn') {
    return execution.stream === 'open' && (!turn || execution.turn === turn)
  }
  if (execution.kind === 'steer-transition') {
    return execution.stream === 'open' && (!turn || execution.continuationTurn === turn)
  }
  if (execution.kind === 'autonomous-turn') {
    return execution.stream === 'open' && (!turn || execution.turn === turn)
  }
  return false
}

/**
 * Busy ⇔ the machine is not fully idle. A turn-kind execution counts as busy even after its terminal
 * outcome is recorded: only `turn-terminal` (persistence confirmed) returns the execution to `idle`,
 * so a dispatcher can never begin a clobbering fresh turn inside a settle window.
 */
export function isAgentSessionRuntimeBusy<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return (
    isAgentSessionRuntimeCompacting(state) ||
    state.launch.kind !== 'idle' ||
    state.queue.length > 0 ||
    state.execution.kind !== 'idle'
  )
}

export function willAgentSessionRuntimeContinue<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  const hasDeferredTurn = state.execution.kind === 'autonomous-turn' && state.execution.deferredTurn !== undefined
  return (
    isAgentSessionRuntimeCompacting(state) ||
    state.queue.length > 0 ||
    state.launch.kind !== 'idle' ||
    state.execution.kind === 'steer-transition' ||
    hasDeferredTurn
  )
}
