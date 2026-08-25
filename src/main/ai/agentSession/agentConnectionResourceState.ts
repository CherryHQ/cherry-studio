import type { UIMessageChunk } from 'ai'

import type {
  AgentRuntimeConnection,
  AgentRuntimeRedirectId,
  AgentRuntimeRedirectInput,
  AgentRuntimeSegmentId
} from '../runtime/types'

export enum AgentConnectionResourceEventType {
  AutonomousTurnCleared = 'autonomous-turn-cleared',
  AutonomousTurnCreated = 'autonomous-turn-created',
  AutonomousTurnState = 'autonomous-turn-state',
  BeginTurn = 'begin-turn',
  ClearSteerReservation = 'clear-steer-reservation',
  CompactionInterrupted = 'compaction-interrupted',
  ConnectionConnected = 'connection-connected',
  ConnectionDisconnected = 'connection-disconnected',
  ConnectionOccupancy = 'connection-occupancy',
  ConnectionRebuildDeferred = 'connection-rebuild-deferred',
  ConnectionStarted = 'connection-started',
  ContinuationTurnCreated = 'continuation-turn-created',
  DeliverBuffer = 'deliver-buffer',
  DeliverChunk = 'deliver-chunk',
  FlushTransition = 'flush-transition',
  LogInvalidTransition = 'log-invalid-transition',
  ReleaseBackgroundWaiter = 'release-background-waiter',
  RedirectQueued = 'redirect-queued',
  ReserveSteer = 'reserve-steer',
  Reset = 'reset',
  DriverTerminal = 'driver-terminal',
  CloseTurnStream = 'close-turn-stream',
  SteerBoundary = 'steer-boundary',
  SteerUndelivered = 'steer-undelivered',
  TurnSentToConnection = 'turn-sent-to-connection',
  TurnStreamOpened = 'turn-stream-opened',
  TurnReleased = 'turn-released',
  RuntimeChunk = 'runtime-chunk'
}

export enum AgentDriverOutcomeKind {
  Success = 'success',
  Paused = 'paused',
  Error = 'error'
}

export enum AgentStreamResourcePhase {
  Unopened = 'unopened',
  Open = 'open',
  AwaitingRelease = 'awaiting-release',
  Released = 'released'
}

export enum AgentConnectionDeliveryPhase {
  Pending = 'pending',
  Sent = 'sent'
}

export enum AgentConnectionOccupancyKind {
  Background = 'background',
  Compaction = 'compaction'
}

export enum AgentAutonomousGenerationState {
  Started = 'started',
  Finished = 'finished'
}

export enum AgentAutonomousResourceOwnership {
  Active = 'active',
  Released = 'released'
}

export enum AgentConnectionResourceKind {
  Idle = 'idle',
  Disconnected = 'disconnected',
  Connecting = 'connecting',
  Connected = 'connected',
  Turn = 'turn',
  SteerTransition = 'steer-transition',
  AutonomousTurn = 'autonomous-turn'
}

export type AgentDriverOutcome =
  | { status: AgentDriverOutcomeKind.Success }
  | { status: AgentDriverOutcomeKind.Paused }
  | { status: AgentDriverOutcomeKind.Error; error?: unknown }
export interface AgentConnectionTargetSnapshot {
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
export interface AgentConnectionOccupancy {
  /** Detached tasks keep the connection alive. Deliberately not "busy": user turns may still start. */
  background?: true
  /** A context rewrite is in flight and keeps the connection resource occupied. */
  compaction?: true
}

export type AgentConnectionLifecycleState =
  | { kind: AgentConnectionResourceKind.Disconnected }
  | { kind: AgentConnectionResourceKind.Connecting; connectionAttemptId: string }
  | {
      kind: AgentConnectionResourceKind.Connected
      connection: AgentRuntimeConnection
      occupancy: AgentConnectionOccupancy
      /** A spawn-frozen config mismatch waiting for background occupancy to drain before rebuilding. */
      pendingRebuild?: AgentConnectionTargetSnapshot
    }

export type AgentGenerationResourceState<TTurn, TReservation> =
  | { kind: AgentConnectionResourceKind.Idle; lastTurn?: TTurn }
  | {
      kind: AgentConnectionResourceKind.Turn
      turn: TTurn
      segmentId: AgentRuntimeSegmentId
      stream: AgentStreamResourcePhase
      delivery: AgentConnectionDeliveryPhase
      redirects: readonly AgentRuntimeRedirectInput[]
      reservation?: TReservation
      driverOutcome?: AgentDriverOutcome
    }
  | {
      kind: AgentConnectionResourceKind.SteerTransition
      sourceTurn: TTurn
      sourceSegmentId: AgentRuntimeSegmentId
      successorSegmentId: AgentRuntimeSegmentId
      sourceStream: AgentStreamResourcePhase.AwaitingRelease | AgentStreamResourcePhase.Released
      continuationTurn?: TTurn
      redirects: readonly AgentRuntimeRedirectInput[]
      headless: boolean
      reservation?: TReservation
      buffer: UIMessageChunk[]
      stream: AgentStreamResourcePhase
      driverOutcome?: AgentDriverOutcome
    }
  | {
      kind: AgentConnectionResourceKind.AutonomousTurn
      segmentId: AgentRuntimeSegmentId
      turn?: TTurn
      contextTurn?: TTurn
      ownership: AgentAutonomousResourceOwnership
      buffer: UIMessageChunk[]
      stream: AgentStreamResourcePhase
      driverOutcome?: AgentDriverOutcome
      releaseOutcome?: AgentDriverOutcomeKind
    }

export interface AgentConnectionResourceState<TTurn, TReservation> {
  generation: AgentGenerationResourceState<TTurn, TReservation>
  connection: AgentConnectionLifecycleState
}

export type AgentConnectionResourceEvent<TTurn, TReservation> =
  | {
      type: AgentConnectionResourceEventType.BeginTurn
      turn: TTurn
      segmentId: AgentRuntimeSegmentId
      stream?: AgentStreamResourcePhase
      delivery?: AgentConnectionDeliveryPhase
    }
  | { type: AgentConnectionResourceEventType.RedirectQueued; redirect: AgentRuntimeRedirectInput }
  | { type: AgentConnectionResourceEventType.ReserveSteer; reservation: TReservation }
  | { type: AgentConnectionResourceEventType.ClearSteerReservation }
  | {
      type: AgentConnectionResourceEventType.SteerBoundary
      redirectIds: readonly AgentRuntimeRedirectId[]
      sourceSegmentId: AgentRuntimeSegmentId
      successorSegmentId: AgentRuntimeSegmentId
      headless: boolean
    }
  | {
      type: AgentConnectionResourceEventType.SteerUndelivered
      redirectIds: readonly AgentRuntimeRedirectId[]
      sourceSegmentId: AgentRuntimeSegmentId
    }
  | {
      type: AgentConnectionResourceEventType.AutonomousTurnState
      state: AgentAutonomousGenerationState
      segmentId: AgentRuntimeSegmentId
      contextTurn?: TTurn
    }
  | { type: AgentConnectionResourceEventType.AutonomousTurnCleared }
  | { type: AgentConnectionResourceEventType.AutonomousTurnCreated; turn: TTurn }
  | { type: AgentConnectionResourceEventType.ContinuationTurnCreated; turn: TTurn }
  | { type: AgentConnectionResourceEventType.TurnStreamOpened; turn: TTurn }
  | { type: AgentConnectionResourceEventType.TurnSentToConnection; turn: TTurn }
  | { type: AgentConnectionResourceEventType.RuntimeChunk; segmentId: AgentRuntimeSegmentId; chunk: UIMessageChunk }
  | {
      type: AgentConnectionResourceEventType.DriverTerminal
      segmentId: AgentRuntimeSegmentId
      outcome: AgentDriverOutcome
    }
  | { type: AgentConnectionResourceEventType.FlushTransition }
  | { type: AgentConnectionResourceEventType.TurnReleased; turnId: string; turn: TTurn; status: AgentDriverOutcomeKind }
  | {
      type: AgentConnectionResourceEventType.ConnectionOccupancy
      occupancy: AgentConnectionOccupancyKind
      active: boolean
    }
  | { type: AgentConnectionResourceEventType.ConnectionStarted; connectionAttemptId: string }
  | {
      type: AgentConnectionResourceEventType.ConnectionConnected
      connectionAttemptId: string
      connection: AgentRuntimeConnection
    }
  | {
      type: AgentConnectionResourceEventType.ConnectionRebuildDeferred
      connection: AgentRuntimeConnection
      target: AgentConnectionTargetSnapshot
    }
  | { type: AgentConnectionResourceEventType.ConnectionDisconnected; connection?: AgentRuntimeConnection }
  | { type: AgentConnectionResourceEventType.Reset }

export type AgentConnectionResourceEffect<TTurn> =
  | { type: AgentConnectionResourceEventType.DeliverBuffer; turn: TTurn; chunks: UIMessageChunk[] }
  | { type: AgentConnectionResourceEventType.DeliverChunk; turn: TTurn; chunk: UIMessageChunk }
  | { type: AgentConnectionResourceEventType.CloseTurnStream; turn: TTurn; outcome: AgentDriverOutcome }
  | { type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter; connection?: AgentRuntimeConnection }
  /** A connection died while a compaction occupied it — its projected status must leave `compacting`. */
  | { type: AgentConnectionResourceEventType.CompactionInterrupted }
  | { type: AgentConnectionResourceEventType.LogInvalidTransition; event: string; state: string }

export interface AgentConnectionResourceTransition<TTurn, TReservation> {
  state: AgentConnectionResourceState<TTurn, TReservation>
  effects: AgentConnectionResourceEffect<TTurn>[]
}

const MAX_PENDING_SEGMENT_CHUNKS = 10_000

function appendPendingChunk(chunks: readonly UIMessageChunk[], chunk: UIMessageChunk): UIMessageChunk[] {
  return [...chunks.slice(-(MAX_PENDING_SEGMENT_CHUNKS - 1)), chunk]
}

export function createAgentConnectionResourceState<TTurn, TReservation>(): AgentConnectionResourceState<
  TTurn,
  TReservation
> {
  return {
    generation: { kind: AgentConnectionResourceKind.Idle },
    connection: { kind: AgentConnectionResourceKind.Disconnected }
  }
}

function invalid<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>,
  event: AgentConnectionResourceEvent<TTurn, TReservation>
): AgentConnectionResourceTransition<TTurn, TReservation> {
  return {
    state,
    effects: [
      { type: AgentConnectionResourceEventType.LogInvalidTransition, event: event.type, state: state.generation.kind }
    ]
  }
}

/** Occupancy dies with its connection; these effects hand the interruption to the host. */
function connectionTeardownEffects<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): AgentConnectionResourceEffect<TTurn>[] {
  if (state.connection.kind !== AgentConnectionResourceKind.Connected) return []
  return [
    { type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection: state.connection.connection },
    ...(state.connection.occupancy.compaction
      ? [{ type: AgentConnectionResourceEventType.CompactionInterrupted } as const]
      : [])
  ]
}

export function transitionAgentConnectionResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>,
  event: AgentConnectionResourceEvent<TTurn, TReservation>
): AgentConnectionResourceTransition<TTurn, TReservation> {
  switch (event.type) {
    case AgentConnectionResourceEventType.BeginTurn:
      if (state.generation.kind !== AgentConnectionResourceKind.Idle) return invalid(state, event)
      return {
        state: {
          ...state,
          generation: {
            kind: AgentConnectionResourceKind.Turn,
            turn: event.turn,
            segmentId: event.segmentId,
            stream: event.stream ?? AgentStreamResourcePhase.Unopened,
            delivery: event.delivery ?? AgentConnectionDeliveryPhase.Pending,
            redirects: []
          }
        },
        effects: []
      }
    case AgentConnectionResourceEventType.RedirectQueued:
      if (
        state.generation.kind !== AgentConnectionResourceKind.Turn ||
        state.generation.segmentId !== event.redirect.segmentId ||
        state.generation.redirects.some(({ redirectId }) => redirectId === event.redirect.redirectId)
      ) {
        return invalid(state, event)
      }
      return {
        state: {
          ...state,
          generation: {
            ...state.generation,
            redirects: [...state.generation.redirects, event.redirect]
          }
        },
        effects: []
      }
    case AgentConnectionResourceEventType.ReserveSteer:
      if (state.generation.kind !== AgentConnectionResourceKind.Turn || state.generation.reservation)
        return invalid(state, event)
      return {
        state: { ...state, generation: { ...state.generation, reservation: event.reservation } },
        effects: []
      }
    case AgentConnectionResourceEventType.ClearSteerReservation:
      if (state.generation.kind === AgentConnectionResourceKind.Turn && state.generation.reservation) {
        const { turn, segmentId, stream, delivery, redirects, driverOutcome } = state.generation
        const generation: AgentGenerationResourceState<TTurn, TReservation> = {
          kind: AgentConnectionResourceKind.Turn,
          turn,
          segmentId,
          stream,
          delivery,
          redirects,
          ...(driverOutcome ? { driverOutcome } : {})
        }
        return { state: { ...state, generation }, effects: [] }
      }
      return { state, effects: [] }
    case AgentConnectionResourceEventType.SteerBoundary:
      if (
        state.generation.kind !== AgentConnectionResourceKind.Turn ||
        state.generation.stream !== AgentStreamResourcePhase.Open ||
        state.generation.segmentId !== event.sourceSegmentId
      )
        return invalid(state, event)
      const source = state.generation
      const delivered: AgentRuntimeRedirectInput[] = []
      for (const redirectId of event.redirectIds) {
        const redirect = source.redirects.find((candidate) => candidate.redirectId === redirectId)
        if (!redirect) return invalid(state, event)
        delivered.push(redirect)
      }
      if (delivered.length === 0) return invalid(state, event)
      return {
        state: {
          ...state,
          generation: {
            kind: AgentConnectionResourceKind.SteerTransition,
            sourceTurn: source.turn,
            sourceSegmentId: event.sourceSegmentId,
            successorSegmentId: event.successorSegmentId,
            sourceStream: AgentStreamResourcePhase.AwaitingRelease,
            redirects: delivered,
            headless: event.headless,
            ...(source.reservation ? { reservation: source.reservation } : {}),
            buffer: [],
            stream: AgentStreamResourcePhase.Unopened
          }
        },
        effects: [
          {
            type: AgentConnectionResourceEventType.CloseTurnStream,
            turn: source.turn,
            outcome: { status: AgentDriverOutcomeKind.Success }
          }
        ]
      }
    case AgentConnectionResourceEventType.SteerUndelivered: {
      if (
        state.generation.kind !== AgentConnectionResourceKind.Turn ||
        state.generation.segmentId !== event.sourceSegmentId
      ) {
        return { state, effects: [] }
      }
      const undelivered = new Set(event.redirectIds)
      const generation = state.generation
      if (event.redirectIds.some((redirectId) => !generation.redirects.some((r) => r.redirectId === redirectId))) {
        return { state, effects: [] }
      }
      return {
        state: {
          ...state,
          generation: {
            ...generation,
            redirects: generation.redirects.filter(({ redirectId }) => !undelivered.has(redirectId))
          }
        },
        effects: []
      }
    }
    case AgentConnectionResourceEventType.AutonomousTurnState: {
      if (event.state === AgentAutonomousGenerationState.Started) {
        if (state.generation.kind === AgentConnectionResourceKind.AutonomousTurn) return { state, effects: [] }
        if (state.generation.kind === AgentConnectionResourceKind.SteerTransition) return invalid(state, event)
        return {
          state: {
            ...state,
            generation: {
              kind: AgentConnectionResourceKind.AutonomousTurn,
              segmentId: event.segmentId,
              ...(event.contextTurn ? { contextTurn: event.contextTurn } : {}),
              ownership: AgentAutonomousResourceOwnership.Active,
              buffer: [],
              stream: AgentStreamResourcePhase.Unopened
            }
          },
          effects: []
        }
      }
      if (
        state.generation.kind !== AgentConnectionResourceKind.AutonomousTurn ||
        state.generation.segmentId !== event.segmentId
      ) {
        return { state, effects: [] }
      }
      return {
        state: {
          ...state,
          generation: { ...state.generation, ownership: AgentAutonomousResourceOwnership.Released }
        },
        effects: []
      }
    }
    case AgentConnectionResourceEventType.AutonomousTurnCleared: {
      if (state.generation.kind !== AgentConnectionResourceKind.AutonomousTurn) return invalid(state, event)
      return {
        state: {
          ...state,
          generation: {
            kind: AgentConnectionResourceKind.Idle,
            ...(state.generation.turn || state.generation.contextTurn
              ? { lastTurn: state.generation.turn ?? state.generation.contextTurn }
              : {})
          }
        },
        effects: []
      }
    }
    case AgentConnectionResourceEventType.AutonomousTurnCreated:
      if (state.generation.kind !== AgentConnectionResourceKind.AutonomousTurn || state.generation.turn)
        return invalid(state, event)
      return {
        state: { ...state, generation: { ...state.generation, turn: event.turn } },
        effects: []
      }
    case AgentConnectionResourceEventType.ContinuationTurnCreated:
      if (state.generation.kind !== AgentConnectionResourceKind.SteerTransition || state.generation.continuationTurn) {
        return invalid(state, event)
      }
      return {
        state: { ...state, generation: { ...state.generation, continuationTurn: event.turn } },
        effects: []
      }
    case AgentConnectionResourceEventType.TurnStreamOpened: {
      const generation = state.generation
      if (
        generation.kind === AgentConnectionResourceKind.Turn &&
        generation.turn === event.turn &&
        generation.stream === AgentStreamResourcePhase.Unopened
      ) {
        return {
          state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.Open } },
          effects: []
        }
      }
      if (
        generation.kind === AgentConnectionResourceKind.SteerTransition &&
        generation.continuationTurn === event.turn &&
        generation.stream === AgentStreamResourcePhase.Unopened
      ) {
        return {
          state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.Open } },
          effects: []
        }
      }
      if (
        generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
        generation.turn === event.turn &&
        generation.stream === AgentStreamResourcePhase.Unopened
      ) {
        return {
          state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.Open } },
          effects: []
        }
      }
      return invalid(state, event)
    }
    case AgentConnectionResourceEventType.TurnSentToConnection:
      if (state.generation.kind !== AgentConnectionResourceKind.Turn || state.generation.turn !== event.turn)
        return invalid(state, event)
      if (state.generation.delivery === AgentConnectionDeliveryPhase.Sent) return { state, effects: [] }
      return {
        state: { ...state, generation: { ...state.generation, delivery: AgentConnectionDeliveryPhase.Sent } },
        effects: []
      }
    case AgentConnectionResourceEventType.RuntimeChunk: {
      const generation = state.generation
      if (generation.kind === AgentConnectionResourceKind.Turn) {
        if (
          generation.segmentId !== event.segmentId ||
          generation.stream !== AgentStreamResourcePhase.Open ||
          generation.driverOutcome
        ) {
          return { state, effects: [] }
        }
        return {
          state,
          effects: [{ type: AgentConnectionResourceEventType.DeliverChunk, turn: generation.turn, chunk: event.chunk }]
        }
      }
      if (generation.kind === AgentConnectionResourceKind.SteerTransition) {
        if (generation.successorSegmentId !== event.segmentId || generation.driverOutcome) return { state, effects: [] }
        if (generation.stream === AgentStreamResourcePhase.Open && generation.continuationTurn) {
          return {
            state,
            effects: [
              {
                type: AgentConnectionResourceEventType.DeliverChunk,
                turn: generation.continuationTurn,
                chunk: event.chunk
              }
            ]
          }
        }
        if (generation.stream !== AgentStreamResourcePhase.Unopened) return { state, effects: [] }
        return {
          state: {
            ...state,
            generation: { ...generation, buffer: appendPendingChunk(generation.buffer, event.chunk) }
          },
          effects: []
        }
      }
      if (generation.kind === AgentConnectionResourceKind.AutonomousTurn) {
        if (generation.segmentId !== event.segmentId || generation.driverOutcome) return { state, effects: [] }
        if (generation.stream === AgentStreamResourcePhase.Open && generation.turn) {
          return {
            state,
            effects: [
              { type: AgentConnectionResourceEventType.DeliverChunk, turn: generation.turn, chunk: event.chunk }
            ]
          }
        }
        if (generation.stream !== AgentStreamResourcePhase.Unopened) return { state, effects: [] }
        return {
          state: {
            ...state,
            generation: { ...generation, buffer: appendPendingChunk(generation.buffer, event.chunk) }
          },
          effects: []
        }
      }
      return { state, effects: [] }
    }
    case AgentConnectionResourceEventType.DriverTerminal: {
      const generation = state.generation
      if (generation.kind === AgentConnectionResourceKind.Turn) {
        if (generation.segmentId !== event.segmentId) return { state, effects: [] }
        if (generation.stream === AgentStreamResourcePhase.Unopened) {
          if (generation.driverOutcome) return { state, effects: [] }
          return {
            state: { ...state, generation: { ...generation, driverOutcome: event.outcome } },
            effects: []
          }
        }
        if (generation.stream === AgentStreamResourcePhase.Open) {
          return {
            state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.AwaitingRelease } },
            effects: [
              { type: AgentConnectionResourceEventType.CloseTurnStream, turn: generation.turn, outcome: event.outcome }
            ]
          }
        }
        return { state, effects: [] }
      }
      if (generation.kind === AgentConnectionResourceKind.SteerTransition) {
        if (generation.successorSegmentId !== event.segmentId) return { state, effects: [] }
        if (generation.stream === AgentStreamResourcePhase.Unopened) {
          if (generation.driverOutcome) return { state, effects: [] }
          return {
            state: { ...state, generation: { ...generation, driverOutcome: event.outcome } },
            effects: []
          }
        }
        if (generation.stream === AgentStreamResourcePhase.Open && generation.continuationTurn) {
          return {
            state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.AwaitingRelease } },
            effects: [
              {
                type: AgentConnectionResourceEventType.CloseTurnStream,
                turn: generation.continuationTurn,
                outcome: event.outcome
              }
            ]
          }
        }
        return { state, effects: [] }
      }
      if (generation.kind === AgentConnectionResourceKind.AutonomousTurn) {
        if (generation.segmentId !== event.segmentId) return { state, effects: [] }
        if (generation.stream === AgentStreamResourcePhase.Unopened) {
          if (generation.driverOutcome) return { state, effects: [] }
          return { state: { ...state, generation: { ...generation, driverOutcome: event.outcome } }, effects: [] }
        }
        if (generation.stream === AgentStreamResourcePhase.Open && generation.turn) {
          return {
            state: { ...state, generation: { ...generation, stream: AgentStreamResourcePhase.AwaitingRelease } },
            effects: [
              { type: AgentConnectionResourceEventType.CloseTurnStream, turn: generation.turn, outcome: event.outcome }
            ]
          }
        }
        return { state, effects: [] }
      }
      return invalid(state, event)
    }
    case AgentConnectionResourceEventType.FlushTransition: {
      const generation = state.generation
      if (generation.kind === AgentConnectionResourceKind.Turn) {
        if (generation.stream !== AgentStreamResourcePhase.Open || !generation.driverOutcome)
          return { state, effects: [] }
        return {
          state: {
            ...state,
            generation: {
              kind: AgentConnectionResourceKind.Turn,
              turn: generation.turn,
              segmentId: generation.segmentId,
              stream: AgentStreamResourcePhase.AwaitingRelease,
              delivery: generation.delivery,
              redirects: generation.redirects,
              ...(generation.reservation ? { reservation: generation.reservation } : {})
            }
          },
          effects: [
            {
              type: AgentConnectionResourceEventType.CloseTurnStream,
              turn: generation.turn,
              outcome: generation.driverOutcome
            }
          ]
        }
      }
      if (generation.kind === AgentConnectionResourceKind.SteerTransition) {
        if (
          !generation.continuationTurn ||
          generation.sourceStream !== AgentStreamResourcePhase.Released ||
          generation.stream !== AgentStreamResourcePhase.Open
        ) {
          return invalid(state, event)
        }
        return {
          state: {
            ...state,
            generation: {
              kind: AgentConnectionResourceKind.Turn,
              turn: generation.continuationTurn,
              segmentId: generation.successorSegmentId,
              stream: generation.driverOutcome
                ? AgentStreamResourcePhase.AwaitingRelease
                : AgentStreamResourcePhase.Open,
              delivery: AgentConnectionDeliveryPhase.Sent,
              redirects: []
            }
          },
          effects: [
            {
              type: AgentConnectionResourceEventType.DeliverBuffer,
              turn: generation.continuationTurn,
              chunks: generation.buffer
            },
            ...(generation.driverOutcome
              ? [
                  {
                    type: AgentConnectionResourceEventType.CloseTurnStream,
                    turn: generation.continuationTurn,
                    outcome: generation.driverOutcome
                  } as const
                ]
              : [])
          ]
        }
      }
      if (
        generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
        generation.turn &&
        generation.stream === AgentStreamResourcePhase.Open
      ) {
        return {
          state: {
            ...state,
            generation: {
              ...generation,
              buffer: [],
              stream: generation.driverOutcome
                ? AgentStreamResourcePhase.AwaitingRelease
                : AgentStreamResourcePhase.Open,
              driverOutcome: undefined
            }
          },
          effects: [
            { type: AgentConnectionResourceEventType.DeliverBuffer, turn: generation.turn, chunks: generation.buffer },
            ...(generation.driverOutcome
              ? [
                  {
                    type: AgentConnectionResourceEventType.CloseTurnStream,
                    turn: generation.turn,
                    outcome: generation.driverOutcome
                  } as const
                ]
              : [])
          ]
        }
      }
      return { state, effects: [] }
    }
    case AgentConnectionResourceEventType.TurnReleased: {
      const generation = state.generation
      if (generation.kind === AgentConnectionResourceKind.SteerTransition && generation.sourceTurn === event.turn) {
        if (event.status === AgentDriverOutcomeKind.Success) {
          if (generation.sourceStream === AgentStreamResourcePhase.Released) return { state, effects: [] }
          return {
            state: {
              ...state,
              generation: { ...generation, sourceStream: AgentStreamResourcePhase.Released }
            },
            effects: []
          }
        }
        return {
          state: {
            ...state,
            generation: { kind: AgentConnectionResourceKind.Idle, lastTurn: event.turn }
          },
          effects: []
        }
      }
      if (generation.kind === AgentConnectionResourceKind.AutonomousTurn && generation.turn === event.turn) {
        return {
          state: {
            ...state,
            generation: {
              ...generation,
              stream: AgentStreamResourcePhase.Released,
              releaseOutcome: event.status
            }
          },
          effects: []
        }
      }
      if (generation.kind === AgentConnectionResourceKind.Turn && generation.turn === event.turn) {
        return {
          state: {
            ...state,
            generation: { kind: AgentConnectionResourceKind.Idle, lastTurn: event.turn }
          },
          effects: []
        }
      }
      if (generation.kind === AgentConnectionResourceKind.Idle) return { state, effects: [] }
      return invalid(state, event)
    }
    case AgentConnectionResourceEventType.ConnectionOccupancy: {
      const connection = state.connection
      if (connection.kind !== AgentConnectionResourceKind.Connected) {
        // A cleared occupancy is already structurally gone with the connection; only an activation
        // without a connection is a protocol violation worth logging.
        return event.active ? invalid(state, event) : { state, effects: [] }
      }
      if (event.occupancy === AgentConnectionOccupancyKind.Compaction) {
        if (event.active === (connection.occupancy.compaction === true)) return { state, effects: [] }
        const occupancy = { ...connection.occupancy }
        if (event.active) occupancy.compaction = true
        else delete occupancy.compaction
        return { state: { ...state, connection: { ...connection, occupancy } }, effects: [] }
      }
      if (event.active) {
        if (connection.occupancy.background) return { state, effects: [] }
        return {
          state: {
            ...state,
            connection: {
              ...connection,
              occupancy: { ...connection.occupancy, background: true }
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
        state: {
          ...state,
          connection: { kind: AgentConnectionResourceKind.Connected, connection: connection.connection, occupancy }
        },
        effects: [{ type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter, connection: connection.connection }]
      }
    }
    case AgentConnectionResourceEventType.ConnectionStarted:
      if (state.connection.kind !== AgentConnectionResourceKind.Disconnected) return invalid(state, event)
      return {
        state: {
          ...state,
          connection: {
            kind: AgentConnectionResourceKind.Connecting,
            connectionAttemptId: event.connectionAttemptId
          }
        },
        effects: []
      }
    case AgentConnectionResourceEventType.ConnectionConnected:
      if (
        state.connection.kind !== AgentConnectionResourceKind.Connecting ||
        state.connection.connectionAttemptId !== event.connectionAttemptId
      ) {
        return invalid(state, event)
      }
      return {
        state: {
          ...state,
          connection: { kind: AgentConnectionResourceKind.Connected, connection: event.connection, occupancy: {} }
        },
        effects: []
      }
    case AgentConnectionResourceEventType.ConnectionRebuildDeferred:
      if (
        state.connection.kind !== AgentConnectionResourceKind.Connected ||
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
    case AgentConnectionResourceEventType.ConnectionDisconnected: {
      if (
        event.connection &&
        state.connection.kind === AgentConnectionResourceKind.Connected &&
        state.connection.connection !== event.connection
      ) {
        return invalid(state, event)
      }
      return {
        state: { ...state, connection: { kind: AgentConnectionResourceKind.Disconnected } },
        effects: connectionTeardownEffects(state)
      }
    }
    case AgentConnectionResourceEventType.Reset:
      return {
        state: createAgentConnectionResourceState<TTurn, TReservation>(),
        effects: [
          {
            type: AgentConnectionResourceEventType.ReleaseBackgroundWaiter,
            connection:
              state.connection.kind === AgentConnectionResourceKind.Connected ? state.connection.connection : undefined
          },
          ...(state.connection.kind === AgentConnectionResourceKind.Connected && state.connection.occupancy.compaction
            ? [{ type: AgentConnectionResourceEventType.CompactionInterrupted } as const]
            : [])
        ]
      }
  }
}

export function getAgentCurrentStreamResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): TTurn | undefined {
  switch (state.generation.kind) {
    case AgentConnectionResourceKind.Turn:
      return state.generation.turn
    case AgentConnectionResourceKind.SteerTransition:
      return state.generation.continuationTurn ?? state.generation.sourceTurn
    case AgentConnectionResourceKind.AutonomousTurn:
      return state.generation.turn
    case AgentConnectionResourceKind.Idle:
      return state.generation.lastTurn
  }
}

export function getAgentCurrentSegmentId<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): AgentRuntimeSegmentId | undefined {
  switch (state.generation.kind) {
    case AgentConnectionResourceKind.Turn:
      return state.generation.segmentId
    case AgentConnectionResourceKind.SteerTransition:
      return state.generation.successorSegmentId
    case AgentConnectionResourceKind.AutonomousTurn:
      return state.generation.segmentId
    case AgentConnectionResourceKind.Idle:
      return undefined
  }
}

/**
 * Machine-derived turn liveness for connection resources. A turn is live until its close effect
 * has been issued (stream left `unopened`/`open`) or it is no longer referenced by the
 * generation. A merely recorded driver outcome (`generation.driverOutcome` latched while the stream is
 * still unopened) keeps the turn live: its stream must still open so the outcome can flush into it.
 */
export function isAgentStreamResourceLive<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>,
  turn: TTurn
): boolean {
  const generation = state.generation
  switch (generation.kind) {
    case AgentConnectionResourceKind.Idle:
      return false
    case AgentConnectionResourceKind.Turn:
      return (
        generation.turn === turn &&
        (generation.stream === AgentStreamResourcePhase.Unopened || generation.stream === AgentStreamResourcePhase.Open)
      )
    case AgentConnectionResourceKind.SteerTransition:
      // The source turn settled at the boundary; only the continuation can still be live.
      return (
        generation.continuationTurn === turn &&
        (generation.stream === AgentStreamResourcePhase.Unopened || generation.stream === AgentStreamResourcePhase.Open)
      )
    case AgentConnectionResourceKind.AutonomousTurn:
      return (
        generation.turn === turn &&
        (generation.stream === AgentStreamResourcePhase.Unopened || generation.stream === AgentStreamResourcePhase.Open)
      )
  }
}

export function getAgentLiveStreamResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): TTurn | undefined {
  const turn = getAgentCurrentStreamResource(state)
  return turn !== undefined && isAgentStreamResourceLive(state, turn) ? turn : undefined
}

export function getAgentConnectionResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): AgentRuntimeConnection | undefined {
  return state.connection.kind === AgentConnectionResourceKind.Connected ? state.connection.connection : undefined
}

export function getAgentConnectionOccupancy<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): AgentConnectionOccupancy | undefined {
  return state.connection.kind === AgentConnectionResourceKind.Connected ? state.connection.occupancy : undefined
}

export function hasAgentConnectionBackgroundWork<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): boolean {
  return getAgentConnectionOccupancy(state)?.background !== undefined
}

export function hasAgentCompactionResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): boolean {
  return getAgentConnectionOccupancy(state)?.compaction === true
}

export function isAgentStreamResourceTransitioning<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): boolean {
  return (
    state.generation.kind === AgentConnectionResourceKind.SteerTransition ||
    state.generation.kind === AgentConnectionResourceKind.AutonomousTurn ||
    (state.generation.kind === AgentConnectionResourceKind.Turn &&
      state.generation.stream === AgentStreamResourcePhase.AwaitingRelease)
  )
}

export function isAgentAutonomousResourceActive<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): boolean {
  return (
    state.generation.kind === AgentConnectionResourceKind.AutonomousTurn &&
    state.generation.ownership === AgentAutonomousResourceOwnership.Active
  )
}

export function isAgentTurnSentToConnection<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>,
  turn: TTurn
): boolean {
  const generation = state.generation
  if (generation.kind === AgentConnectionResourceKind.Turn)
    return generation.turn === turn && generation.delivery === AgentConnectionDeliveryPhase.Sent
  if (generation.kind === AgentConnectionResourceKind.SteerTransition) {
    return generation.sourceTurn === turn || generation.continuationTurn === turn
  }
  return generation.kind === AgentConnectionResourceKind.AutonomousTurn && generation.turn === turn
}

export function hasOpenAgentStreamResource<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>,
  turn?: TTurn
): boolean {
  const generation = state.generation
  if (generation.kind === AgentConnectionResourceKind.Turn) {
    return generation.stream === AgentStreamResourcePhase.Open && (!turn || generation.turn === turn)
  }
  if (generation.kind === AgentConnectionResourceKind.SteerTransition) {
    return generation.stream === AgentStreamResourcePhase.Open && (!turn || generation.continuationTurn === turn)
  }
  if (generation.kind === AgentConnectionResourceKind.AutonomousTurn) {
    return generation.stream === AgentStreamResourcePhase.Open && (!turn || generation.turn === turn)
  }
  return false
}

/**
 * Busy means the resource machine is not fully idle. A turn generation stays busy after a driver outcome
 * is recorded; only the persisted `TurnReleased` event returns the generation to Idle,
 * so a dispatcher can never begin a clobbering fresh turn inside a settle window.
 */
export function hasAgentConnectionResources<TTurn, TReservation>(
  state: AgentConnectionResourceState<TTurn, TReservation>
): boolean {
  return hasAgentCompactionResource(state) || state.generation.kind !== AgentConnectionResourceKind.Idle
}
