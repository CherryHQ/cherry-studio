import { randomUUID } from 'node:crypto'
import { rmSync } from 'node:fs'

import { transformMessages } from '@earendil-works/pi-ai/api/transform-messages'
import { buildSessionContext, convertToLlm, SessionManager } from '@earendil-works/pi-coding-agent'

import {
  type ChildFacts,
  type ConversationFacts,
  decodeEntry,
  encodeEntry,
  FORK_PLACEHOLDER_RESULT,
  type Key,
  type Step,
  type TxOp
} from '@cherrystudio/agent-behavior'
import { type JsonValue, runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

import { historyOf, keysOf, omittedMarkers, resultFor, unansweredCalls, withoutMarkers } from './history'
import {
  type Adapter,
  type Conversation,
  isIdle,
  type JobRecord,
  markerMessage,
  newConversation,
  type Owner
} from './state'

type Applied = {
  readonly spawned: { readonly key: Key; readonly child: ThreadId }[]
  /** Children reserved by the commit; their sessions are built after it. */
  readonly children: Conversation[]
  /** Jobs the commit made live, for the caller to start. */
  readonly jobs: JobRecord[]
}
/**
 * One operation, checked: `create` makes the storage a spawn needs, `persist` makes its disk writes, which can throw,
 * and `register` applies what cannot be taken back (the adapter's maps, a session's context).
 */
type Prepared = {
  readonly create?: () => SessionManager
  readonly persist?: () => void
  readonly register?: (applied: Applied) => void
}
/** The entry a refused commit appends where it put a branch back; the facts leave it out. */
const ROLLBACK_KIND = 'cherry.rollback'

/** H1 read: the whole branch as history, the run state Pi does not keep, direct children, and keys. */
export function readFacts(adapter: Adapter, thread: ThreadId): ConversationFacts {
  const conv = adapter.conversation(thread)
  const history = historyOf(conv.manager.getBranch(), thread)
  const keysSeen = keysOf(history)
  for (const job of adapter.jobs.values()) if (job.state === 'live' && job.thread === thread) keysSeen.add(job.key)
  const children = new Map<ThreadId, ChildFacts>()
  let pendingLaunches = 0
  for (const child of adapter.conversations.values()) {
    if (child.lineage.kind !== 'subagent' || child.lineage.parent !== thread) continue
    children.set(child.thread, {
      running: child.active !== undefined,
      runUsage: [...child.runUsage],
      // Never empty: the child's origin record is written with it.
      lastItem: historyOf(child.manager.getBranch(), child.thread).at(-1)!.id
    })
    if (!child.native) pendingLaunches += 1
  }
  const run = conv.active
  return {
    thread,
    lineage: conv.lineage,
    history,
    live: {
      idle: isIdle(conv),
      leftoverInputs: run ? 0 : conv.inbox.length,
      queuedUserInput: conv.inbox.some((key) => typeof conv.submissions.get(key)?.input === 'string'),
      // G6: a host prompt or compact accepted but not started as a run, or a compaction in progress.
      hostCallInFlight:
        conv.hostCompacts > 0 ||
        conv.native?.session.isCompacting === true ||
        (run?.pending === true && run.startedBy === undefined),
      ...(conv.lastEnd && { runEnd: { outcome: conv.lastEnd } }),
      pendingLaunches
    },
    children,
    keysSeen
  }
}

/**
 * H1 transact: reads, decides and writes in one synchronous section, in three phases: every operation is checked, then
 * the children's storage is created, then every disk write runs (`persist`), and only once all of them succeeded what
 * cannot be taken back (`register`). A commit that throws on the way leaves no record on any branch, no child, no job
 * and no session file: a failed write puts back each branch the writes moved and appends a `cherry.rollback` entry
 * there, so a reload, which takes a file's last entry as the leaf, lands on that branch too.
 */
export function commit<R extends JsonValue>(
  adapter: Adapter,
  thread: ThreadId,
  decide: (facts: ConversationFacts) => Step<R>,
  owner: Owner | undefined
): { readonly step: Step<R>; readonly applied: Applied } {
  const step = decide(readFacts(adapter, thread))
  const prepared = step.ops.map((op) => prepare(adapter, thread, op, owner))
  const created: SessionManager[] = []
  try {
    for (const { create } of prepared) if (create) created.push(create())
    persistAll(adapter, prepared)
  } catch (error) {
    // forkFrom writes the fork's file as it creates it.
    for (const manager of created) if (manager.isPersisted()) rmSync(manager.getSessionFile()!, { force: true })
    throw error
  }
  const applied: Applied = { spawned: [], children: [], jobs: [] }
  for (const { register } of prepared) register?.(applied)
  return { step, applied }
}

/** Runs every operation's disk writes; when one throws, puts back each conversation's branch they moved. */
function persistAll(adapter: Adapter, prepared: readonly Prepared[]): void {
  const leaves = new Map([...adapter.conversations.values()].map(({ manager }) => [manager, manager.getLeafId()]))
  try {
    for (const { persist } of prepared) persist?.()
  } catch (error) {
    for (const [manager, leaf] of leaves) {
      if (manager.getLeafId() === leaf) continue
      const restore = () => (leaf === null ? manager.resetLeaf() : manager.branch(leaf))
      restore()
      try {
        manager.appendCustomEntry(ROLLBACK_KIND, { error: error instanceof Error ? error.message : String(error) })
      } catch (failure) {
        // The refused rollback entry is not on disk, so a later write must not follow it.
        restore()
        adapter.report(failure)
      }
    }
    throw error
  }
}

function prepare(adapter: Adapter, thread: ThreadId, op: TxOp, owner: Owner | undefined): Prepared {
  switch (op.type) {
    case 'append-record': {
      const target = adapter.conversation(op.thread)
      const { kind, data } = encodeEntry(op.record, op.key)
      return {
        persist: () => {
          target.manager.appendCustomEntry(kind, data)
        }
      }
    }
    case 'append-quiet': {
      const target = adapter.conversation(op.thread)
      if (!isIdle(target)) throw new Error(`append-quiet refused: ${op.thread} is not idle`)
      const message = markerMessage(op.input, op.key)
      // The id only fills the kind check; `op.key` is never empty, and `runtimeId` rejects an empty id.
      if (
        decodeEntry({ id: runtimeId<'item'>(op.key), kind: message.customType, data: message.details })?.kind !==
        'marker'
      )
        throw new Error(`append-quiet needs a marker input, got ${op.input.kind}`)
      // Not `sendCustomMessage`: a disk failure there only rejects its promise, after Pi moved the leaf.
      return {
        persist: () => {
          target.manager.appendCustomMessageEntry(message.customType, message.content, message.display, message.details)
        },
        // What Pi does after its own append; its message events are left out (README H1).
        register: () => target.native!.session.refreshContext()
      }
    }
    case 'spawn-child': {
      const { spec, key } = op
      if (spec.boundary === 'foreground' && !owner)
        throw new Error('A foreground child can only be spawned from a tool call')
      const parent = adapter.conversation(thread)
      const fork = spec.fork && { source: adapter.conversation(spec.fork.from).manager, at: spec.fork.at }
      if (spec.fork && !fork?.source.getEntry(spec.fork.at))
        throw new Error(`Fork point ${spec.fork.at} is not in ${spec.fork.from}`)
      const child = runtimeId<'thread'>(randomUUID())
      let manager!: SessionManager
      return {
        // forkFrom/create touch the disk and can throw, which must reject the whole commit.
        create: () => (manager = childManager(parent.manager, child, fork)),
        persist: () => {
          // Parent calls keep running there; calls copied from another child need the interrupted result (H3).
          const copied = manager.getBranch()
          const placeholders = spec.fork?.from === thread ? unansweredCalls(copied, copied.length - 1) : []
          for (const call of placeholders) manager.appendMessage(resultFor(call, FORK_PLACEHOLDER_RESULT, false))
          const origin = encodeEntry({ type: 'subagent-origin', value: spec.origin }, key)
          manager.appendCustomEntry(origin.kind, origin.data)
          const record = encodeEntry({ type: 'subagent-run', value: { ...spec.record, sessionId: child } }, key)
          parent.manager.appendCustomEntry(record.kind, record.data)
        },
        register: (applied) => {
          const lineage = { kind: 'subagent' as const, parent: thread, origin: spec.origin }
          const conv = newConversation(
            child,
            manager,
            lineage,
            spec.boundary === 'foreground' ? owner : undefined,
            false
          )
          adapter.conversations.set(child, conv)
          applied.spawned.push({ key, child })
          applied.children.push(conv)
        }
      }
    }
    case 'ensure-job': {
      if (!adapter.installation.jobs.has(op.job.kind))
        throw new Error(`No job handler is registered for ${op.job.kind}`)
      return {
        register: (applied) => {
          // H4: deduplicated by key, never by kind; a live job keeps its key, an ended one frees it.
          if (adapter.jobs.get(op.key)?.state === 'live') return
          const job: JobRecord = { key: op.key, spec: op.job, thread, state: 'live' }
          adapter.jobs.set(op.key, job)
          applied.jobs.push(job)
        }
      }
    }
  }
}

/** What the next request would carry: Pi's compaction-aware context without the markers the context filter omits. */
export function modelContext(adapter: Adapter, thread: ThreadId): JsonValue[] {
  const conv = adapter.conversation(thread)
  const model = conv.native?.session.model
  if (!model) throw new Error(`Conversation ${thread} has no model`)
  const { messages } = buildSessionContext(conv.manager.getEntries(), conv.manager.getLeafId())
  const omit = adapter.installation.filter?.omit(thread, readFacts(adapter, thread)) ?? []
  const visible = withoutMarkers(messages, omittedMarkers(conv.manager.getBranch(), omit))
  return JSON.parse(JSON.stringify(transformMessages(convertToLlm(visible), model))) as JsonValue[]
}

/** A child's native storage in its parent's persistence mode, starting from `fork.source` up to `fork.at` when forked. */
function childManager(
  parent: SessionManager,
  id: ThreadId,
  fork: { readonly source: SessionManager; readonly at: string } | undefined
): SessionManager {
  const options = { id, parentSession: parent.getSessionFile() }
  const manager = !parent.isPersisted()
    ? SessionManager.inMemory(parent.getCwd(), options, fork ? fork.source.getBranch(fork.at) : [])
    : fork
      ? SessionManager.forkFrom(fork.source.getSessionFile()!, parent.getCwd(), parent.getSessionDir(), options)
      : SessionManager.create(parent.getCwd(), parent.getSessionDir(), options)
  if (fork) manager.branch(fork.at)
  return manager
}
