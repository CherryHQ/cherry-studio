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
  knowledgeBaseIds: readonly string[]
}

export type AgentSessionRuntimeConnectionState =
  | { kind: 'disconnected' }
  | { kind: 'connecting'; attemptId: string }
  | { kind: 'connected'; connection: AgentRuntimeConnection }
  | {
      kind: 'rebuild-blocked'
      connection: AgentRuntimeConnection
      target: AgentSessionRuntimeConnectionTarget
    }

export type AgentSessionRuntimeBackgroundState =
  | { kind: 'inactive' }
  | { kind: 'active'; responder: 'interactive' | 'headless' }

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
  background: AgentSessionRuntimeBackgroundState
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
  | { type: 'background-work-state'; active: boolean; responder?: 'interactive' | 'headless' }
  | { type: 'connection-started'; attemptId: string }
  | { type: 'connection-connected'; attemptId: string; connection: AgentRuntimeConnection }
  | {
      type: 'connection-rebuild-blocked'
      connection: AgentRuntimeConnection
      target: AgentSessionRuntimeConnectionTarget
    }
  | { type: 'connection-disconnected'; connection?: AgentRuntimeConnection }
  | { type: 'reset' }

export type AgentSessionRuntimeStateEffect<TTurn> =
  | { type: 'schedule-launch'; target: AgentSessionRuntimeLaunchTarget }
  | { type: 'deliver-buffer'; turn: TTurn; chunks: UIMessageChunk[] }
  | { type: 'settle-turn'; turn: TTurn; outcome: AgentSessionTerminalOutcome }
  | { type: 'mark-turn-terminal'; turn: TTurn; status: AgentSessionTerminalStatus }
  | { type: 'release-background-waiter'; connection?: AgentRuntimeConnection }
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
    connection: { kind: 'disconnected' },
    background: { kind: 'inactive' }
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
        launch: canSchedule ? { kind: 'scheduled', target: 'deferred-turn' } : state.launch
      },
      effects: [
        ...(execution.turn
          ? [{ type: 'mark-turn-terminal', turn: execution.turn, status: execution.settled } as const]
          : []),
        ...(canSchedule ? [{ type: 'schedule-launch', target: 'deferred-turn' } as const] : [])
      ]
    }
  }
  return {
    state: {
      ...state,
      execution: {
        kind: 'idle',
        ...(execution.turn || execution.contextTurn ? { lastTurn: execution.turn ?? execution.contextTurn } : {})
      }
    },
    effects: execution.turn ? [{ type: 'mark-turn-terminal', turn: execution.turn, status: execution.settled }] : []
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
              launch: { kind: 'scheduled', target: 'steer-continuation' }
            },
            effects: [
              { type: 'mark-turn-terminal', turn: event.turn, status: event.status },
              { type: 'schedule-launch', target: 'steer-continuation' }
            ]
          }
        }
        return {
          state: { ...state, execution: { kind: 'idle', lastTurn: event.turn } },
          effects: [{ type: 'mark-turn-terminal', turn: event.turn, status: event.status }]
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
          state: { ...state, execution: { kind: 'idle', lastTurn: event.turn } },
          effects: [{ type: 'mark-turn-terminal', turn: event.turn, status: event.status }]
        }
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
    case 'background-work-state': {
      if (event.active) {
        if (state.background.kind === 'active') return { state, effects: [] }
        return {
          state: {
            ...state,
            background: { kind: 'active', responder: event.responder ?? 'headless' }
          },
          effects: []
        }
      }
      if (state.background.kind === 'inactive') return { state, effects: [] }
      const blockedConnection = state.connection.kind === 'rebuild-blocked' ? state.connection.connection : undefined
      return {
        state: {
          ...state,
          background: { kind: 'inactive' },
          connection: blockedConnection ? { kind: 'connected', connection: blockedConnection } : state.connection
        },
        effects: [
          {
            type: 'release-background-waiter',
            connection: blockedConnection
          }
        ]
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
        state: { ...state, connection: { kind: 'connected', connection: event.connection } },
        effects: []
      }
    case 'connection-rebuild-blocked':
      if (
        state.connection.kind !== 'connected' ||
        state.connection.connection !== event.connection ||
        state.background.kind !== 'active'
      ) {
        return invalid(state, event)
      }
      return {
        state: {
          ...state,
          connection: { kind: 'rebuild-blocked', connection: event.connection, target: event.target }
        },
        effects: []
      }
    case 'connection-disconnected':
      if (
        event.connection &&
        state.connection.kind !== 'disconnected' &&
        state.connection.kind !== 'connecting' &&
        state.connection.connection !== event.connection
      ) {
        return invalid(state, event)
      }
      return { state: { ...state, connection: { kind: 'disconnected' } }, effects: [] }
    case 'reset':
      return {
        state: createAgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>(),
        effects: [
          {
            type: 'release-background-waiter',
            connection:
              state.connection.kind === 'connected' || state.connection.kind === 'rebuild-blocked'
                ? state.connection.connection
                : undefined
          }
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

export function getAgentSessionRuntimeLiveTurn<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  isTerminal: (turn: TTurn) => boolean
): TTurn | undefined {
  const turn = getAgentSessionRuntimeCurrentTurn(state)
  return turn && !isTerminal(turn) ? turn : undefined
}

export function getAgentSessionRuntimeConnection<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): AgentRuntimeConnection | undefined {
  return state.connection.kind === 'connected' || state.connection.kind === 'rebuild-blocked'
    ? state.connection.connection
    : undefined
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

export function isAgentSessionRuntimeBusy<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>,
  isTerminal: (turn: TTurn) => boolean
): boolean {
  return (
    state.launch.kind !== 'idle' ||
    state.queue.length > 0 ||
    state.execution.kind === 'steer-transition' ||
    state.execution.kind === 'autonomous-turn' ||
    (state.execution.kind === 'turn' && state.execution.stream === 'awaiting-persistence') ||
    getAgentSessionRuntimeLiveTurn(state, isTerminal) !== undefined
  )
}

export function willAgentSessionRuntimeContinue<TTurn, TPendingTurn, TReservation>(
  state: AgentSessionRuntimeState<TTurn, TPendingTurn, TReservation>
): boolean {
  return (
    state.queue.length > 0 ||
    state.launch.kind !== 'idle' ||
    state.execution.kind === 'steer-transition' ||
    state.execution.kind === 'autonomous-turn'
  )
}
