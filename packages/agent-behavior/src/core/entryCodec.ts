import type { ItemId, JsonValue, ThreadId } from '@cherrystudio/agent-runtime'

import { type Fields, isFields } from './args'
import {
  type DeliveredRun,
  ENTRY_KINDS,
  type EntryKind,
  type GoalCleared,
  type GoalNotice,
  type GoalPhase,
  type GoalSnapshot,
  type HistoryEntry,
  type MarkerFact,
  type PlanState,
  type PolicyRecord,
  type RoundDetails,
  type SubagentOrigin,
  type SubagentOutcome,
  type SubagentRunRecord,
  type SubagentStopper
} from './facts'

export type EncodedEntry = { readonly kind: EntryKind; readonly data: JsonValue }
export type RawEntry = {
  readonly id: ItemId
  readonly kind: string
  readonly data: JsonValue | undefined
  readonly text?: string
}

type TurnStop = Extract<PolicyRecord, { readonly type: 'turn-stop' }>['value']
type SubagentSteer = Extract<PolicyRecord, { readonly type: 'subagent-steer' }>['value']

/** Every member of a union as a key, so a member added to the union fails to compile until the decoder accepts it. */
type Members<T extends string> = { readonly [member in T]: true }
const GOAL_PHASES: Members<GoalPhase> = { active: true, paused: true, blocked: true, complete: true }
const NOTICE_LEVELS: Members<GoalNotice['level']> = { info: true, error: true }
const RUN_STATUSES: Members<SubagentRunRecord['status']> = { running: true, finished: true }
const ROUND_KINDS: Members<RoundDetails['kind']> = { work: true, hint: true, 'wrap-up': true }
const OUTCOMES: Members<SubagentOutcome> = {
  completed: true,
  failed: true,
  truncated: true,
  aborted: true,
  limit_reached: true,
  stopped: true,
  interrupted: true
}
const STOPPERS: Members<SubagentStopper> = { model: true, user: true, budget: true }
const STOP_CAUSES: Members<TurnStop['cause']> = { user: true, 'goal-command': true, reopen: true }

const isMember = (value: JsonValue, members: object): boolean =>
  typeof value === 'string' && Object.hasOwn(members, value)
const isOptionalMember = (value: JsonValue | undefined, members: object): boolean =>
  value === undefined || isMember(value, members)
const withKey = (fields: Fields, key: string | undefined): Fields => (key === undefined ? fields : { ...fields, key })

/** Lays a record or marker out as agent-runtime-pi stores it today; a given `key` travels as one extra `key` field. */
export function encodeEntry(fact: PolicyRecord | MarkerFact, key?: string): EncodedEntry {
  switch (fact.type) {
    case 'goal':
      return { kind: ENTRY_KINDS.goal, data: withKey(fact.value, key) }
    case 'goal-notice':
      return { kind: ENTRY_KINDS.goalNotice, data: withKey(fact.value, key) }
    case 'subagent-run':
      return { kind: ENTRY_KINDS.subagentRun, data: withKey(fact.value, key) }
    case 'subagent-origin':
      return { kind: ENTRY_KINDS.subagentOrigin, data: withKey(fact.value, key) }
    case 'plan':
      return { kind: ENTRY_KINDS.plan, data: withKey(fact.value, key) }
    case 'turn-stop':
      return { kind: ENTRY_KINDS.turnStop, data: withKey(fact.value, key) }
    case 'idle-driver-exit':
      return { kind: ENTRY_KINDS.idleDriverExit, data: withKey(fact.value, key) }
    case 'subagent-steer':
      return { kind: ENTRY_KINDS.subagentSteer, data: withKey(fact.value, key) }
    case 'goal-round':
      return { kind: ENTRY_KINDS.goalRound, data: withKey(fact.round, key) }
    case 'subagent-notification':
      return { kind: ENTRY_KINDS.subagentNotification, data: withKey({ subagents: fact.runs, quiet: fact.quiet }, key) }
    case 'subagent-status':
      return { kind: ENTRY_KINDS.subagentStatus, data: withKey({}, key) }
    case 'subagent-message':
      return { kind: ENTRY_KINDS.subagentMessage, data: withKey({}, key) }
  }
}

/** Reads one stored entry back; a foreign kind or malformed data yields `undefined` rather than a throw. */
export function decodeEntry(entry: RawEntry): HistoryEntry | undefined {
  // Status and message markers may store no data; every other kind then fails its own field checks.
  const data = entry.data ?? {}
  if (!isFields(data)) return undefined
  const { key, ...fields } = data
  if (key !== undefined && typeof key !== 'string') return undefined
  const keyed = key === undefined ? {} : { key }
  const record = decodeRecord(entry.kind, fields)
  if (record) return { kind: 'record', id: entry.id, ...keyed, record }
  const marker = decodeMarker(entry.kind, fields)
  return marker ? { kind: 'marker', id: entry.id, ...keyed, marker, text: entry.text ?? '' } : undefined
}

function decodeRecord(kind: string, f: Fields): PolicyRecord | undefined {
  switch (kind) {
    case ENTRY_KINDS.goal: {
      if (typeof f.id !== 'string' || typeof f.revision !== 'number') return undefined
      const valid =
        'cleared' in f
          ? f.cleared === true && typeof f.at === 'number'
          : isMember(f.phase, GOAL_PHASES) && typeof f.armed === 'boolean'
      return valid ? { type: 'goal', value: f as GoalSnapshot | GoalCleared } : undefined
    }
    case ENTRY_KINDS.goalNotice:
      return typeof f.text === 'string' && isMember(f.level, NOTICE_LEVELS)
        ? { type: 'goal-notice', value: f as GoalNotice }
        : undefined
    case ENTRY_KINDS.subagentRun:
      return typeof f.sessionId === 'string' &&
        typeof f.run === 'number' &&
        isMember(f.status, RUN_STATUSES) &&
        isOptionalMember(f.outcome, OUTCOMES) &&
        isOptionalMember(f.stoppedBy, STOPPERS)
        ? { type: 'subagent-run', value: f as SubagentRunRecord }
        : undefined
    case ENTRY_KINDS.subagentOrigin:
      return typeof f.parentToolCallId === 'string' &&
        typeof f.description === 'string' &&
        typeof f.modelKey === 'string' &&
        typeof f.fork === 'boolean'
        ? { type: 'subagent-origin', value: f as SubagentOrigin }
        : undefined
    case ENTRY_KINDS.plan:
      return typeof f.active === 'boolean' && typeof f.at === 'number'
        ? { type: 'plan', value: f as PlanState }
        : undefined
    case ENTRY_KINDS.turnStop:
      return typeof f.at === 'number' && isMember(f.cause, STOP_CAUSES)
        ? { type: 'turn-stop', value: f as TurnStop }
        : undefined
    case ENTRY_KINDS.idleDriverExit:
      return typeof f.generation === 'number'
        ? { type: 'idle-driver-exit', value: f as { readonly generation: number } }
        : undefined
    case ENTRY_KINDS.subagentSteer:
      return typeof f.sessionId === 'string' &&
        typeof f.run === 'number' &&
        typeof f.digest === 'string' &&
        typeof f.withdrawn === 'boolean'
        ? { type: 'subagent-steer', value: f as SubagentSteer }
        : undefined
    default:
      return undefined
  }
}

function decodeMarker(kind: string, f: Fields): MarkerFact | undefined {
  switch (kind) {
    case ENTRY_KINDS.goalRound:
      return typeof f.id === 'string' &&
        typeof f.goalId === 'string' &&
        typeof f.revision === 'number' &&
        typeof f.round === 'number' &&
        isMember(f.kind, ROUND_KINDS)
        ? { type: 'goal-round', round: f as RoundDetails }
        : undefined
    case ENTRY_KINDS.subagentNotification: {
      const runs = decodeRuns(f.subagents)
      return runs ? { type: 'subagent-notification', runs, quiet: f.quiet === true } : undefined
    }
    case ENTRY_KINDS.subagentStatus:
      return { type: 'subagent-status' }
    case ENTRY_KINDS.subagentMessage:
      return { type: 'subagent-message' }
    default:
      return undefined
  }
}

/** Keeps what a notification delivers today; the per-run `usage` older entries carry is dropped (R3). */
function decodeRuns(list: JsonValue): DeliveredRun[] | undefined {
  if (!Array.isArray(list)) return undefined
  const runs: DeliveredRun[] = []
  for (const item of list) {
    if (!isFields(item)) return undefined
    const { sessionId, run, outcome, stoppedBy } = item
    if (typeof sessionId !== 'string' || typeof run !== 'number' || !isMember(outcome, OUTCOMES)) return undefined
    if (!isOptionalMember(stoppedBy, STOPPERS)) return undefined
    const delivered = { sessionId: sessionId as ThreadId, run, outcome: outcome as SubagentOutcome }
    runs.push(stoppedBy === undefined ? delivered : { ...delivered, stoppedBy: stoppedBy as SubagentStopper })
  }
  return runs
}
