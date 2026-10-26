import { readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'

import type { TSchema } from '@earendil-works/pi-ai'
import { type ExtensionAPI, SessionManager } from '@earendil-works/pi-coding-agent'
import { describe, expect, it } from 'vitest'

import {
  type ChildSpec,
  type ConversationFacts,
  createScriptedHost,
  encodeEntry,
  type HarnessPorts,
  type HostPorts,
  install,
  type Key,
  type MessageResult,
  type ToolDefinition,
  type TurnInput,
  type TxOp
} from '@cherrystudio/agent-behavior'
import { type ItemId, runtimeId, type ThreadId } from '@cherrystudio/agent-runtime'

import type { AgentRuntimeEvent, AgentRuntimeSession, BehaviorSessionRequest, CompactionSummarizer } from '../src'
import { historyOf } from '../src/behavior/history'
import { type OpenSession, openPiHarness, type PiHarness } from './behaviorHarness'

const read = (pi: PiHarness, thread: ThreadId): Promise<ConversationFacts> =>
  pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))

function latch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}
const aborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve()
    signal.addEventListener('abort', () => resolve(), { once: true })
  })

const key = (label: string) => `test:${label}` as Key
const input = (text: string): TurnInput => ({ ...encodeEntry({ type: 'subagent-message' }), text })
const spec: ChildSpec = {
  boundary: 'background',
  origin: { parentToolCallId: 'call', fork: false, description: 'child', modelKey: 'contract/model' },
  record: {
    parentToolCallId: 'call',
    description: 'child',
    fork: false,
    background: true,
    modelKey: 'contract/model',
    run: 1,
    status: 'running'
  }
}
const noLifecycle = {
  onOpen: async () => {},
  onCompacting: async () => ({ summary: 'summary' }),
  onCompacted: async () => {},
  onClose: async () => {}
}
const tool = (name: string): ToolDefinition => ({
  name,
  description: name,
  schema: { type: 'object' },
  replay: 'safe',
  executionMode: 'sequential',
  availability: 'all',
  modelOnly: true,
  run: async () => ({ text: name, isError: false })
})
/** A tool whose call waits until released or aborted. */
function holdTool(name = 'hold') {
  const started = latch()
  const gate = latch()
  const definition: ToolDefinition = {
    ...tool(name),
    run: async (call) => {
      started.release()
      await Promise.race([gate.promise, aborted(call.signal)])
      return { text: 'held', isError: false }
    }
  }
  return { tool: definition, started: started.promise, release: gate.release }
}
const markerKeys = (facts: ConversationFacts) =>
  facts.history.flatMap((entry) => (entry.kind === 'marker' ? [entry.key] : []))
/** Sessions that compact on their own after a reply: the threshold sits one token above an empty context. */
const autoCompacting =
  (onEvent?: (event: AgentRuntimeEvent) => void) => (request: BehaviorSessionRequest, open: OpenSession) =>
    open(request, {
      compaction: { reserveTokens: 31_999, keepRecentTokens: 1, summarize: request.summarize },
      ...(onEvent && { onEvent })
    })
/** The package itself, on a scripted host that lets every call run; `patch` replaces host ports it gets. */
const installPackage = (ports: HarnessPorts, patch: (host: HostPorts) => HostPorts = (host) => host): void => {
  install(
    ports,
    patch(
      createScriptedHost({
        settings: {
          goalDefaults: { maxGoalRounds: 8, maxGoalRoundsCeiling: 50, blockedAfter: 3 },
          autonomy: 'auto',
          permissionMode: 'auto',
          attendance: 'stream',
          maxBackground: 4,
          offloadThreshold: 20_000
        }
      })
    )
  )
}
const spawnInBackground = {
  text: '',
  toolCalls: [{ name: 'subagent', args: { description: 'scan', prompt: 'scan the repo', background: true } }]
}
async function spawn(pi: PiHarness, parent: ThreadId, fork?: ChildSpec['fork']): Promise<ThreadId> {
  const { spawned } = await pi.harness.withCall(parent, (ports) =>
    ports.ledger.transact(parent, () => ({
      ops: [{ type: 'spawn-child', spec: fork ? { ...spec, fork } : spec, key: key('spawn') }],
      effects: [],
      result: null
    }))
  )
  return spawned[0].child
}
/**
 * A stored parent and a stored conversation, one turn behind each; the second one's storage is moved away, so its
 * writes fail until `restore` brings it back.
 */
async function brokenStorage(pi: PiHarness) {
  const sessions = join(pi.cwd, 'sessions')
  const manager = SessionManager.create(pi.cwd, sessions)
  const parent = await pi.behavior.openConversation(manager)
  const gone = join(pi.cwd, 'gone')
  const brokenManager = SessionManager.create(pi.cwd, gone)
  const broken = await pi.behavior.openConversation(brokenManager)
  for (const thread of [parent, broken]) {
    pi.harness.script(thread, [{ text: 'one' }])
    await pi.harness.sendUser(thread, 'first')
  }
  await pi.harness.settle()
  renameSync(gone, `${gone}-away`)
  return {
    parent,
    broken,
    sessions,
    file: manager.getSessionFile()!,
    brokenFile: brokenManager.getSessionFile()!,
    restore: () => renameSync(`${gone}-away`, gone)
  }
}
const notice = (thread: ThreadId, label: string): TxOp => ({
  type: 'append-record',
  thread,
  record: { type: 'goal-notice', value: { text: label, level: 'info' } },
  key: key(label)
})
const quiet = (thread: ThreadId, text: string): TxOp => ({
  type: 'append-quiet',
  thread,
  input: input(text),
  key: key(text)
})

describe('coding-agent behavior adapter', () => {
  // Catches a stop made while Pi still prepares a person's prompt (its input handlers run): Pi clears that abort when
  // it starts the run, so unless the adapter repeats it at agent_start the run goes on and asks the model.
  it('stops a run that Pi is still preparing', async () => {
    const gate = latch()
    const pi = await openPiHarness(() => {}, [
      (api) => {
        api.on('input', async () => {
          await gate.promise
          return { action: 'continue' as const }
        })
      }
    ])
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'never' }])
    await pi.harness.sendUser(t, 'go')
    const stopping = pi.harness.withCall(t, (ports) => ports.turns.stop(t, 'user'))
    gate.release()
    await stopping
    const facts = await read(pi, t)
    expect(facts.live.runEnd?.outcome).toBe('aborted')
    expect(facts.history.some((entry) => entry.kind === 'assistant' && entry.text === 'never')).toBe(false)
  })

  // Catches a retried stop that names an earlier turn aborting the run a person started after it while Pi still
  // prepares that run: its message is not on the branch yet, so the branch's last person's message is the earlier one.
  it('leaves a later run going when a retried stop names an earlier turn', async () => {
    const gate = latch()
    const pi = await openPiHarness(() => {}, [
      (api) => {
        api.on('input', async (event) => {
          if (event.text === 'second') await gate.promise
          return { action: 'continue' as const }
        })
      }
    ])
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first done' }, { text: 'second done' }])
    await pi.harness.sendUser(t, 'first')
    await pi.harness.settle()
    const turn = (await read(pi, t)).history.find((entry) => entry.kind === 'user')!.id
    await pi.harness.sendUser(t, 'second')
    const stopping = pi.harness.withCall(t, (ports) => ports.turns.stop(t, 'user', turn))
    gate.release()
    await stopping
    await pi.harness.settle()
    const facts = await read(pi, t)
    expect(facts.live.runEnd?.outcome).toBe('completed')
    expect(facts.history.some((entry) => entry.kind === 'assistant' && entry.text === 'second done')).toBe(true)
  })

  // Catches a stop that cannot tell a run began with a turn input (a goal round, a notification), whose first entry is
  // its custom message rather than a person's message: a person's stop naming that round would leave it running.
  it('stops the run a turn input began when a stop names its message', async () => {
    const hold = holdTool()
    const pi = await openPiHarness((ports) => ports.tools.register(hold.tool))
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: '', toolCalls: [{ name: 'hold', args: {} }] }, { text: 'never' }])
    await pi.harness.withCall(t, (ports) => ports.turns.start(t, input('go'), key('round')))
    await hold.started
    const turn = (await read(pi, t)).history.find((entry) => entry.kind === 'marker' && entry.key === key('round'))!.id
    await pi.harness.withCall(t, (ports) => ports.turns.stop(t, 'user', turn))
    expect((await read(pi, t)).live.runEnd?.outcome).toBe('aborted')
  })

  // Catches accepted input lost after Pi's final steering check, or attributed to the completed run's answer.
  it('continues with a message that reaches a child while its run settles', async () => {
    const late: { send?: () => Promise<MessageResult>; sent?: Promise<MessageResult> } = {}
    const pi = await openPiHarness(() => {}, [
      (api) => {
        // Not awaited: the run the message would join ends only after this handler.
        api.on('agent_settled', () => {
          late.sent ??= late.send?.()
        })
      }
    ])
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [{ text: 'first' }, { text: 'second' }])
    late.send = () =>
      pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('late'), key('late'), 1))
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work'), 1))
    await pi.harness.settle()
    expect(await late.sent).toEqual({ run: 2, status: 'started' })
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 2, key('late')))).toEqual({
      outcome: 'completed',
      text: 'second'
    })
    expect((await read(pi, parent)).children.get(child)?.runUsage).toHaveLength(2)
    expect(markerKeys(await read(pi, child))).toEqual([key('work'), key('late')])
    expect(await late.send()).toEqual({ run: 2, status: 'started' })
    expect(markerKeys(await read(pi, child))).toEqual([key('work'), key('late')])
  })

  // Catches a steer whose message answers only once the child's run ends instead of when a boundary takes it, which
  // keeps the caller's tool call (message_subagent) waiting for the whole child run (H3).
  it('answers a steer as soon as a boundary of the run takes it', async () => {
    const first = holdTool('first')
    const second = holdTool('second')
    const pi = await openPiHarness((ports) => {
      ports.tools.register(first.tool)
      ports.tools.register(second.tool)
    })
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [
      { text: '', toolCalls: [{ name: 'first', args: {} }] },
      { text: '', toolCalls: [{ name: 'second', args: {} }] },
      { text: 'done' }
    ])
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work'), 1))
    await first.started
    const steer = pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('steer'), key('steer')))
    first.release()
    // The boundary after the first call placed the steer; the run now waits in the second call.
    await second.started
    expect(await Promise.race([steer, Promise.resolve('unanswered')])).toEqual({ run: 1, status: 'queued' })
    second.release()
    await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('work')))
  })

  // Catches a withdrawal that takes the other steers of the run with it (Pi can only clear its whole steering queue):
  // each steer must wait for its own boundary, and only the one whose tool call aborted is withdrawn (H3).
  it('withdraws only the steer whose tool call aborted', async () => {
    const hold = holdTool()
    const steering = latch()
    const sent: { child?: ThreadId; steer?: Promise<MessageResult> } = {}
    const steerer: ToolDefinition = {
      ...tool('steerer'),
      run: async (_call, ports) => {
        sent.steer = ports.helpers.message(sent.child!, input('aborted steer'), key('aborted'))
        steering.release()
        return { text: (await sent.steer).status, isError: false }
      }
    }
    const pi = await openPiHarness((ports) => {
      ports.tools.register(hold.tool)
      ports.tools.register(steerer)
    })
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    sent.child = child
    pi.harness.script(child, [{ text: '', toolCalls: [{ name: 'hold', args: {} }] }, { text: 'child done' }])
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work'), 1))
    await hold.started
    pi.harness.script(parent, [{ text: '', toolCalls: [{ name: 'steerer', args: {} }] }, { text: 'never' }])
    await pi.harness.sendUser(parent, 'go')
    await steering.promise
    const kept = pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('kept'), key('kept')))
    await pi.harness.withCall(parent, (ports) => ports.turns.stop(parent, 'user'))
    expect(await sent.steer).toEqual({ run: 1, status: 'withdrawn' })
    hold.release()
    expect(await kept).toEqual({ run: 1, status: 'queued' })
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('work')))).toEqual({
      outcome: 'completed',
      text: 'child done'
    })
    expect(markerKeys(await read(pi, child))).toEqual([key('work'), key('kept')])
  })

  // Catches a reservation restricting input admission or reusing a previously passed run number.
  it('continues beyond an obsolete run reservation', async () => {
    const pi = await openPiHarness(() => {})
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [{ text: 'second' }, { text: 'third' }])
    const send = (label: string, run: number) =>
      pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input(label), key(label), run))
    expect(await send('second', 2)).toEqual({ run: 2, status: 'started' })
    await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 2, key('second')))
    expect(await send('skipped', 1)).toEqual({ run: 3, status: 'started' })
    await pi.harness.settle()
    expect(markerKeys(await read(pi, child))).toEqual([key('second'), key('skipped')])
    expect((await read(pi, parent)).children.get(child)?.runUsage).toHaveLength(3)
  })

  // Catches a fork that starts the child empty or copies the parent's history past the fork point.
  it('forks a child from the parent history up to the fork point', async () => {
    const pi = await openPiHarness(() => {})
    const parent = await pi.harness.createThread()
    pi.harness.script(parent, [{ text: 'one' }, { text: 'two' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    await pi.harness.sendUser(parent, 'second')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant' && entry.text === 'one')!.id
    const child = await spawn(pi, parent, { from: parent, at })
    const copied = (await read(pi, child)).history.map((entry) =>
      entry.kind === 'assistant' ? entry.text : entry.kind
    )
    expect(copied).toEqual(['user', 'one', 'record'])
  })

  // Catches a fork of a stored (file-backed) parent that starts the child empty, copies history past the fork point
  // or leaves a child that cannot run; every other test forks in memory.
  it('forks a child of a stored parent up to the fork point and runs it', async () => {
    const pi = await openPiHarness(() => {})
    const parent = await pi.behavior.openConversation(SessionManager.create(pi.cwd, join(pi.cwd, 'sessions')))
    pi.harness.script(parent, [{ text: 'one' }, { text: 'two' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    await pi.harness.sendUser(parent, 'second')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant' && entry.text === 'one')!.id
    const child = await spawn(pi, parent, { from: parent, at })
    const copied = (await read(pi, child)).history.map((entry) =>
      entry.kind === 'assistant' ? entry.text : entry.kind
    )
    expect(copied).toEqual(['user', 'one', 'record'])
    pi.harness.script(child, [{ text: 'forked' }])
    const sent = await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('go'), key('go'), 1))
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, sent.run, key('go')))).toEqual(
      { outcome: 'completed', text: 'forked' }
    )
  })

  // Catches a commit refused after a fork's storage was created: Pi writes a fork's session file as it creates it, so
  // the rejected commit would leave an orphan session on disk instead of writing nothing (H1).
  it('leaves no session file when a commit with a fork is refused', async () => {
    const hold = holdTool()
    const pi = await openPiHarness((ports) => ports.tools.register(hold.tool))
    const sessions = join(pi.cwd, 'sessions')
    const parent = await pi.behavior.openConversation(SessionManager.create(pi.cwd, sessions))
    const commit = (ops: TxOp[]) =>
      pi.harness.withCall(parent, (ports) => ports.ledger.transact(parent, () => ({ ops, effects: [], result: null })))
    pi.harness.script(parent, [{ text: 'one' }, { text: '', toolCalls: [{ name: 'hold', args: {} }] }, { text: 'two' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant')!.id
    const fork: TxOp = { type: 'spawn-child', spec: { ...spec, fork: { from: parent, at } }, key: key('fork') }
    // The parent's run keeps it busy, so a quiet input to it cannot apply.
    await pi.harness.sendUser(parent, 'second')
    await hold.started
    const before = readdirSync(sessions)
    const quiet: TxOp = { type: 'append-quiet', thread: parent, input: input('status'), key: key('quiet') }
    await expect(commit([fork, quiet])).rejects.toThrow('append-quiet refused')
    expect(readdirSync(sessions)).toEqual(before)
    const { spawned } = await commit([fork])
    expect(readdirSync(sessions).filter((file) => !before.includes(file))).toEqual([
      expect.stringContaining(spawned[0].child)
    ])
    hold.release()
  })

  // Catches a commit whose later fork fails to create its storage leaving the session file of an earlier fork of the
  // same commit on disk (H1).
  it('removes the session files a commit created when a later fork fails', async () => {
    const pi = await openPiHarness(() => {})
    const sessions = join(pi.cwd, 'sessions')
    const parent = await pi.behavior.openConversation(SessionManager.create(pi.cwd, sessions))
    pi.harness.script(parent, [{ text: 'one' }])
    await pi.harness.sendUser(parent, 'first')
    await pi.harness.settle()
    const at = (await read(pi, parent)).history.find((entry) => entry.kind === 'assistant')!.id
    // Pi writes a stored session's file only once it holds a person's or the model's message; this one never does.
    const unwritten = await pi.behavior.openConversation(SessionManager.create(pi.cwd, sessions))
    const note: TxOp = {
      type: 'append-record',
      thread: unwritten,
      record: { type: 'goal-notice', value: { text: 'note', level: 'info' } },
      key: key('note')
    }
    await pi.harness.withCall(unwritten, (ports) =>
      ports.ledger.transact(unwritten, () => ({ ops: [note], effects: [], result: null }))
    )
    const noteId = (await read(pi, unwritten)).history[0].id
    const before = readdirSync(sessions)
    const forks: TxOp[] = [
      { type: 'spawn-child', spec: { ...spec, fork: { from: parent, at } }, key: key('first fork') },
      { type: 'spawn-child', spec: { ...spec, fork: { from: unwritten, at: noteId } }, key: key('second fork') }
    ]
    await expect(
      pi.harness.withCall(parent, (ports) =>
        ports.ledger.transact(parent, () => ({ ops: forks, effects: [], result: null }))
      )
    ).rejects.toThrow('Cannot fork')
    expect(readdirSync(sessions)).toEqual(before)
  })

  // Catches a commit whose later write fails after a fork's records were written: the parent would keep the child's run
  // record, in memory and on disk, with a reserved child that never launches (H1: a rejected commit writes nothing).
  it('takes back the spawn of a commit whose later write fails', async () => {
    const pi = await openPiHarness(() => {})
    const { parent, broken, sessions, file } = await brokenStorage(pi)
    const before = await read(pi, parent)
    const files = readdirSync(sessions)
    const at = before.history.find((entry) => entry.kind === 'assistant')!.id
    const fork: TxOp = { type: 'spawn-child', spec: { ...spec, fork: { from: parent, at } }, key: key('fork') }
    const commit = (ops: TxOp[]) =>
      pi.harness.withCall(parent, (ports) => ports.ledger.transact(parent, () => ({ ops, effects: [], result: null })))
    await expect(commit([fork, notice(broken, 'lost')])).rejects.toThrow('ENOENT')
    const after = await read(pi, parent)
    expect(after.history).toEqual(before.history)
    expect(after.children.size).toBe(0)
    expect(after.live.pendingLaunches).toBe(0)
    expect(readdirSync(sessions)).toEqual(files)
    expect(historyOf(SessionManager.open(file).getBranch(), parent)).toEqual(before.history)
    // The broken storage cannot take the rollback entry either; that is reported, the commit's own error rethrown.
    expect(pi.errors).toEqual([expect.objectContaining({ code: 'ENOENT' })])
    const { spawned } = await commit([fork])
    expect(readdirSync(sessions).filter((name) => !files.includes(name))).toEqual([
      expect.stringContaining(spawned[0].child)
    ])
    expect((await read(pi, parent)).children.size).toBe(1)
  })

  // Catches a refused commit leaving its first write on the branch: in memory, or after a reload, where Pi takes the
  // file's last entry as the leaf (H1).
  it('leaves no write of a refused commit on the branch, also after a reload', async () => {
    const pi = await openPiHarness(() => {})
    const { parent, broken, file } = await brokenStorage(pi)
    const before = (await read(pi, parent)).history
    const ops = [notice(parent, 'first'), notice(broken, 'second')]
    await expect(
      pi.harness.withCall(parent, (ports) => ports.ledger.transact(parent, () => ({ ops, effects: [], result: null })))
    ).rejects.toThrow('ENOENT')
    expect((await read(pi, parent)).history).toEqual(before)
    expect(historyOf(SessionManager.open(file).getBranch(), parent)).toEqual(before)
  })

  // Catches a quiet input that fails to write letting its commit succeed: the leaf stays on an entry the disk never
  // got, so once storage is back the next write hangs off it and a reload loses the conversation (H1).
  it('refuses a commit whose quiet input fails to write and keeps later writes on the stored branch', async () => {
    const pi = await openPiHarness(() => {})
    const { broken, brokenFile, restore } = await brokenStorage(pi)
    const before = (await read(pi, broken)).history
    const commit = (ops: TxOp[]) =>
      pi.harness.withCall(broken, (ports) => ports.ledger.transact(broken, () => ({ ops, effects: [], result: null })))
    await expect(commit([quiet(broken, 'lost status')])).rejects.toThrow('ENOENT')
    expect((await read(pi, broken)).history).toEqual(before)
    restore()
    expect(historyOf(SessionManager.open(brokenFile).getBranch(), broken)).toEqual(before)
    await commit([notice(broken, 'later')])
    const after = (await read(pi, broken)).history
    expect(after).toEqual([...before, expect.objectContaining({ kind: 'record', key: key('later') })])
    expect(historyOf(SessionManager.open(brokenFile).getBranch(), broken)).toEqual(after)
  })

  // Catches a quiet input written by a commit that a later write then refuses staying on its conversation's branch, in
  // memory or after a reload (H1: a rejected commit writes nothing).
  it('takes back the quiet input of a refused commit, also after a reload', async () => {
    const pi = await openPiHarness(() => {})
    const { parent, broken, file } = await brokenStorage(pi)
    const before = (await read(pi, parent)).history
    const ops = [quiet(parent, 'taken back'), notice(broken, 'lost')]
    await expect(
      pi.harness.withCall(parent, (ports) => ports.ledger.transact(parent, () => ({ ops, effects: [], result: null })))
    ).rejects.toThrow('ENOENT')
    expect((await read(pi, parent)).history).toEqual(before)
    expect(historyOf(SessionManager.open(file).getBranch(), parent)).toEqual(before)
  })

  // Catches a quiet input that reaches the branch but not the session's transcript (`session.messages`, which a host
  // projects), or one that starts a run (H1: the model sees a quiet input without a run starting).
  it('puts a quiet input in the model context and the session transcript without starting a run', async () => {
    const sessions: AgentRuntimeSession[] = []
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        const native = await open(request)
        sessions.push(native)
        return native
      }
    )
    const t = await pi.harness.createThread()
    await pi.harness.withCall(t, (ports) =>
      ports.ledger.transact(t, () => ({ ops: [quiet(t, 'parked status')], effects: [], result: null }))
    )
    expect(markerKeys(await read(pi, t))).toEqual([key('parked status')])
    const context = await pi.harness.withCall(t, (ports) => ports.ledger.modelContext(t))
    expect(JSON.stringify(context)).toContain('parked status')
    expect(sessions[0].session.messages).toContainEqual(
      expect.objectContaining({ role: 'custom', content: 'parked status' })
    )
    await pi.harness.settle()
    expect(pi.requests(t)).toEqual([])
  })

  // Catches onCompacted running while Pi still compacts, where the quiet input it adds (the subagent status after a
  // compaction) is refused as written into a busy conversation.
  it('lets onCompacted add a quiet input once the compaction is over', async () => {
    const pi = await openPiHarness((ports) =>
      ports.lifecycle.register({
        ...noLifecycle,
        onCompacted: async (thread, bound) => {
          await bound.ledger.transact(thread, () => ({
            ops: [{ type: 'append-quiet', thread, input: input('status'), key: key('after-compaction') }],
            effects: [],
            result: null
          }))
        }
      })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first' }])
    await pi.harness.sendUser(t, 'before')
    await pi.harness.settle()
    await pi.harness.compact(t)
    expect((await read(pi, t)).keysSeen.has(key('after-compaction'))).toBe(true)
  })

  // Catches a host compact() released before its onCompacted returns: untilIdle would resolve, and hostCallInFlight read
  // false, while the call still runs its lifecycle handler (H5, G6).
  it('keeps a host compaction in flight until its onCompacted returns', async () => {
    const entered = latch()
    const handler = latch()
    const pi = await openPiHarness((ports) =>
      ports.lifecycle.register({
        ...noLifecycle,
        onCompacted: async () => {
          entered.release()
          await handler.promise
        }
      })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first' }])
    await pi.harness.sendUser(t, 'before')
    await pi.harness.settle()
    const compacting = pi.harness.compact(t)
    await entered.promise
    let idle = false
    const waiting = pi.harness
      .withCall(t, (ports) => ports.waits.untilIdle(t))
      .then(() => {
        idle = true
      })
    // Pi's own compaction has returned by the next macrotask; only onCompacted is pending.
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(idle).toBe(false)
    expect((await read(pi, t)).live.hostCallInFlight).toBe(true)
    handler.release()
    await compacting
    await waiting
    expect((await read(pi, t)).live.hostCallInFlight).toBe(false)
  })

  // Catches a compaction during a run that the meter never sees or that does not count toward the run's requests, so a
  // child's compactions escape its request cap, a refused one that still asks onCompacting or compacts, or a key that
  // is not the entry the compaction follows, so two compactions would share one memoized summary (H11, H12).
  it('meters a compaction during a run as one of its requests', async () => {
    const metered: number[] = []
    const keys: string[] = []
    const errors: (string | undefined)[] = []
    let refuse = false
    const pi = await openPiHarness(
      (ports) => {
        ports.tools.register(tool('echo'))
        ports.requestMeter.register({
          allow: (_thread, requestsInRun) => {
            metered.push(requestsInRun)
            if (!refuse || requestsInRun !== 1) return { ok: true }
            refuse = false
            return { ok: false, text: 'request cap reached' }
          }
        })
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async (_thread, request) => {
            keys.push(request.key)
            return { summary: 'summary' }
          }
        })
      },
      [],
      autoCompacting((event) => {
        if (event.type === 'compaction-end') errors.push(event.error)
      })
    )
    const t = await pi.harness.createThread()
    // The last reply's usage keeps the context under the threshold: only the compaction before the second request runs.
    const usage = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 1, costUsd: 0 }
    const round = [
      { text: '', toolCalls: [{ name: 'echo', args: {} }] },
      { text: 'done', usage }
    ]
    pi.harness.script(t, round)
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    // The tool round's request, the compaction before the next request, that request.
    expect(metered).toEqual([0, 1, 2])
    const first = await read(pi, t)
    expect(first.history.map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
      'tool-result',
      'compaction',
      'assistant'
    ])
    expect(keys).toEqual([`${t}:${first.history[2].id}`])
    refuse = true
    pi.harness.script(t, round)
    await pi.harness.sendUser(t, 'again')
    await pi.harness.settle()
    // The refused compaction asks nothing and counts nothing: the next request still sees one.
    expect(metered).toEqual([0, 1, 2, 0, 1, 1])
    expect(keys).toHaveLength(1)
    const second = await read(pi, t)
    expect(second.history.slice(first.history.length).map((entry) => entry.kind)).toEqual([
      'user',
      'assistant',
      'tool-result',
      'assistant'
    ])
    expect(errors).toEqual([undefined, 'request cap reached'])
    expect(second.live.runEnd?.outcome).toBe('completed')
  })

  // Catches an automatic compaction that still happens after onCompacting declined it (Pi falls back to its own
  // summarizer on the session model), or a decline whose reason never reaches the host as the compaction's error (H12).
  it('compacts nothing when onCompacting declines an automatic compaction', async () => {
    let compacted = 0
    const ends: AgentRuntimeEvent[] = []
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async () => ({ decline: true, reason: 'The summary is empty' }),
          onCompacted: async () => {
            compacted += 1
          }
        }),
      [],
      autoCompacting((event) => {
        if (event.type === 'compaction-end') ends.push(event)
      })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    const facts = await read(pi, t)
    expect(facts.history.map((entry) => entry.kind)).toEqual(['user', 'assistant'])
    expect(compacted).toBe(0)
    expect(ends).toEqual([expect.objectContaining({ error: 'The summary is empty' })])
    expect(facts.live.runEnd?.outcome).toBe('completed')
  })

  // Catches a session whose compaction bypasses the adapter's summarizer (the host left out `compaction.summarize` or
  // passed its own): Pi would compact with its own or the host's summary and never ask onCompacting (H12).
  it.each<[string, CompactionSummarizer | undefined]>([
    ['without a summarizer', undefined],
    ['with its own summarizer', async () => 'host summary']
  ])('refuses to compact a session built %s', async (_label, summarize) => {
    let asked = 0
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onCompacting: async () => {
            asked += 1
            return { summary: 'summary' }
          }
        }),
      [],
      (request, open) =>
        open(request, {
          compaction: { enabled: false, reserveTokens: 1, keepRecentTokens: 1, ...(summarize && { summarize }) }
        })
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'first' }, { text: 'a summary from the session model' }])
    await pi.harness.sendUser(t, 'before')
    await pi.harness.settle()
    await expect(pi.harness.compact(t)).rejects.toThrow()
    expect((await read(pi, t)).history.map((entry) => entry.kind)).toEqual(['user', 'assistant'])
    expect(asked).toBe(0)
    // Pi's own summarizer would have taken the second scripted reply.
    expect(pi.requests(t)).toHaveLength(1)
    expect(pi.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('compaction.summarize') })])
  })

  // Catches a job ensured in onOpen that starts while onOpen is still deciding, instead of once it has run (H12).
  it('starts a job ensured in onOpen only once onOpen has run', async () => {
    const order: string[] = []
    const pi = await openPiHarness((ports) => {
      ports.jobs.register('subagent-report', async () => {
        order.push('job')
      })
      ports.lifecycle.register({
        ...noLifecycle,
        onOpen: async (thread, _open, bound) => {
          const job = { kind: 'subagent-report', scope: thread, input: null, onRestart: 'resume' } as const
          await bound.ledger.transact(thread, () => ({
            ops: [{ type: 'ensure-job', job, key: key('open-job') }],
            effects: [],
            result: null
          }))
          await new Promise((resolve) => setTimeout(resolve, 0))
          order.push('open')
        }
      })
    })
    await pi.harness.createThread()
    await pi.harness.settle()
    expect(order).toEqual(['open', 'job'])
  })

  // Catches a context filter that is consulted but whose omissions never reach the model request or the verifier's
  // context, so an unadmitted goal round would still be sent.
  it('leaves the markers the filter omits out of the request and the model context', async () => {
    let omit: readonly ItemId[] = []
    const pi = await openPiHarness((ports) => ports.contextFilter.register({ omit: () => omit }))
    const t = await pi.harness.createThread()
    await pi.harness.withCall(t, (ports) =>
      ports.ledger.transact(t, () => ({
        ops: [{ type: 'append-quiet', thread: t, input: input('stale round'), key: key('stale') }],
        effects: [],
        result: null
      }))
    )
    omit = [(await read(pi, t)).history.find((entry) => entry.kind === 'marker')!.id]
    pi.harness.script(t, [{ text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    const request = JSON.stringify(pi.requests(t)[0])
    expect(request).toContain('go')
    expect(request).not.toContain('stale round')
    const context = await pi.harness.withCall(t, (ports) => ports.ledger.modelContext(t))
    expect(JSON.stringify(context)).not.toContain('stale round')
  })

  // Catches helpers.stop rejecting for a child of an earlier process (D5: never loaded), which fails onOpen, so a
  // stored conversation whose record says that child was running can no longer be opened.
  it('opens a stored conversation whose onOpen stops a child of an earlier process', async () => {
    let stops = 0
    const pi = await openPiHarness((ports) =>
      ports.lifecycle.register({
        ...noLifecycle,
        onOpen: async (thread, { reopened }, bound) => {
          if (!reopened) return
          for (const entry of (await bound.ledger.read(thread)).history) {
            if (entry.kind !== 'record' || entry.record.type !== 'subagent-run') continue
            if (entry.record.value.status !== 'running') continue
            await bound.helpers.stop(entry.record.value.sessionId, entry.record.value.run)
            stops += 1
          }
        }
      })
    )
    const stored = SessionManager.inMemory(pi.cwd)
    const earlier = runtimeId<'thread'>('earlier-child')
    const record = encodeEntry({ type: 'subagent-run', value: { ...spec.record, sessionId: earlier } }, key('earlier'))
    stored.appendCustomEntry(record.kind, record.data)
    await expect(pi.behavior.openConversation(stored)).resolves.toBe(stored.getSessionId())
    expect(stops).toBe(1)
  })

  // Catches a run another extension starts going unnoticed: it has no run number or end, so the waits resolve while it
  // runs, and the adapter does not drain at its settle, so input submitted while it runs stays stuck.
  it('reports a run the adapter did not start', async () => {
    let foreign: ExtensionAPI | undefined
    const pi = await openPiHarness(() => {}, [
      (api) => {
        foreign = api
      }
    ])
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'foreign' }])
    foreign!.sendMessage({ customType: 'foreign', content: 'go', display: false }, { triggerTurn: true })
    await pi.harness.settle()
    expect(pi.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('did not start') })])
  })

  // Catches a message to a child whose session is still being built recording its key before it fails, so the same
  // key sent again answers 'started' while the child never runs.
  it('keeps the key of a message sent while the child launches', async () => {
    const building = latch()
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        if (request.child) await building.promise
        return open(request)
      }
    )
    const parent = await pi.harness.createThread()
    const spawning = spawn(pi, parent)
    const [child] = (await read(pi, parent)).children.keys()
    const send = () =>
      pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('early'), key('early'), 1))
    await expect(send()).rejects.toThrow()
    building.release()
    await spawning
    pi.harness.script(child, [{ text: 'ran' }])
    expect(await send()).toEqual({ run: 1, status: 'started' })
    expect((await read(pi, parent)).children.get(child)?.running).toBe(true)
    expect(await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('early')))).toEqual({
      outcome: 'completed',
      text: 'ran'
    })
  })

  // Catches a background child's report job starting before the child's session is built: its message fails as sent
  // to a child still launching, so the child never runs and the parent never hears of it (H1, H4).
  it('runs a background child whose session takes a while to build', async () => {
    const children: ThreadId[] = []
    const pi: PiHarness = await openPiHarness(installPackage, [], async (request, open) => {
      if (request.child) {
        const child = runtimeId<'thread'>(request.sessionManager.getSessionId())
        children.push(child)
        pi.harness.script(child, [{ text: 'found 3 files' }])
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      return open(request)
    })
    const parent = await pi.harness.createThread()
    pi.harness.script(parent, [spawnInBackground, { text: 'waiting' }, { text: 'read the report' }])
    await pi.harness.sendUser(parent, 'go')
    await pi.harness.settle()
    const facts = await read(pi, parent)
    expect(pi.errors).toEqual([])
    expect(facts.children.get(children[0])?.runUsage).toHaveLength(1)
    const notified = facts.history.filter(
      (entry) => entry.kind === 'marker' && entry.marker.type === 'subagent-notification'
    )
    expect(notified).toEqual([expect.objectContaining({ text: expect.stringContaining('found 3 files') })])
  })

  // Catches a report job whose child failed to build never settling, or failing as an unhandled rejection instead of
  // through onError, or the child staying in the parent's children (D3).
  it('fails the report job of a background child whose session failed to build', async () => {
    const pi = await openPiHarness(installPackage, [], (request, open) =>
      request.child ? Promise.reject(new Error('build failed')) : open(request)
    )
    const parent = await pi.harness.createThread()
    pi.harness.script(parent, [spawnInBackground, { text: 'went on' }])
    await pi.harness.sendUser(parent, 'go')
    await pi.harness.settle()
    expect((await read(pi, parent)).children.size).toBe(0)
    expect(pi.errors).toEqual([expect.objectContaining({ message: expect.stringContaining('Unknown thread') })])
  })

  // Catches a root session that fails to build staying in the conversation table: opening it again reports it as
  // already open, and close() skips it.
  it('opens a conversation again after its session failed to build', async () => {
    let failing = true
    const pi = await openPiHarness(
      () => {},
      [],
      (request, open) => {
        if (!failing) return open(request)
        failing = false
        return Promise.reject(new Error('build failed'))
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    await expect(pi.behavior.openConversation(manager)).rejects.toThrow('build failed')
    await expect(pi.behavior.openConversation(manager)).resolves.toBe(manager.getSessionId())
  })

  // Catches a person's text submitted while the session is still being built waiting in the inbox forever.
  it('starts text submitted while the session was being built', async () => {
    const building = latch()
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        await building.promise
        return open(request)
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    const t = runtimeId<'thread'>(manager.getSessionId())
    const opening = pi.behavior.openConversation(manager)
    pi.harness.script(t, [{ text: 'answered' }])
    await pi.harness.sendUser(t, 'early')
    building.release()
    await opening
    await pi.harness.settle()
    expect((await read(pi, t)).history.some((entry) => entry.kind === 'assistant' && entry.text === 'answered')).toBe(
      true
    )
  })

  // Catches close() skipping a session still being built: once built, the session would start the text queued before
  // close() and ask the model, and nobody would dispose it.
  it('disposes a session that was still being built when close() began', async () => {
    const building = latch()
    let disposed = 0
    const pi = await openPiHarness(
      () => {},
      [],
      async (request, open) => {
        await building.promise
        const native = await open(request)
        return {
          ...native,
          dispose: async () => {
            disposed += 1
            await native.dispose()
          }
        }
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    const t = runtimeId<'thread'>(manager.getSessionId())
    const opening = pi.behavior.openConversation(manager)
    await pi.harness.sendUser(t, 'early')
    const closing = pi.harness.close()
    const refused = expect(opening).rejects.toThrow('The coding-agent harness is closed')
    building.release()
    await closing
    // close() resolves once the session it found being built is disposed.
    expect(disposed).toBe(1)
    await refused
    expect(pi.requests(t)).toEqual([])
  })

  // Catches close() not waiting for the onOpen of a conversation it overlaps: the open would finish after close()
  // returned, start the text queued while the session was built on a disposed session, and its writes would fail.
  it('finishes an open that close() overlaps before tearing it down', async () => {
    const asked = latch()
    const held = latch()
    let disposed = 0
    const pi = await openPiHarness(
      (ports) =>
        installPackage(ports, (host) => ({
          ...host,
          models: {
            ...host.models,
            // The package's onOpen awaits it.
            current: async (thread) => {
              asked.release()
              await held.promise
              return host.models.current(thread)
            }
          }
        })),
      [],
      async (request, open) => {
        const native = await open(request)
        return {
          ...native,
          dispose: async () => {
            disposed += 1
            await native.dispose()
          }
        }
      }
    )
    const manager = SessionManager.inMemory(pi.cwd)
    const t = runtimeId<'thread'>(manager.getSessionId())
    const order: string[] = []
    const opening = pi.behavior.openConversation(manager)
    const settled = () => order.push('open')
    void opening.then(settled, settled)
    // Sent while the session is being built, the text waits in the inbox for the open to finish.
    await pi.harness.sendUser(t, 'early')
    await asked.promise
    const closing = pi.harness.close().then(() => order.push('close'))
    // Long enough for close() to finish if it did not wait for the open.
    await new Promise((resolve) => setTimeout(resolve, 20))
    held.release()
    await closing
    expect(order).toEqual(['open', 'close'])
    await expect(opening).resolves.toBe(t)
    expect(pi.requests(t)).toEqual([])
    expect(manager.getEntries().some((entry) => entry.type === 'message' && entry.message.role === 'user')).toBe(false)
    expect(pi.errors).toEqual([])
    expect(disposed).toBe(1)
  })

  // Catches close() starting the report job of a background child whose session it cut: the job fails at its first
  // call to the child and reaches onError while the harness shuts down.
  it('starts no report job for a background child whose launch close() cut', async () => {
    const asked = latch()
    const building = latch()
    const pi = await openPiHarness(installPackage, [], async (request, open) => {
      if (request.child) {
        asked.release()
        await building.promise
      }
      return open(request)
    })
    const parent = await pi.harness.createThread()
    pi.harness.script(parent, [spawnInBackground, { text: 'waiting' }])
    await pi.harness.sendUser(parent, 'go')
    await asked.promise
    const closing = pi.harness.close()
    building.release()
    await closing
    expect(pi.errors).toEqual([])
  })

  // Catches close() missing a person's prompt that Pi still prepares (its input handlers run): Pi's abort sees an idle
  // session, so once the handlers return the prompt asks the model of a session close() already disposed.
  it('stops a prompt Pi still prepares before close() disposes its session', async () => {
    const entered = latch()
    const gate = latch()
    let disposed = 0
    let atClose: ConversationFacts['live'] | undefined
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onClose: async (thread, p) => {
            atClose = (await p.ledger.read(thread)).live
          }
        }),
      [
        (api) => {
          api.on('input', async () => {
            entered.release()
            await gate.promise
            return { action: 'continue' as const }
          })
        }
      ],
      async (request, open) => {
        const native = await open(request)
        return {
          ...native,
          dispose: async () => {
            disposed += 1
            await native.dispose()
          }
        }
      }
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: 'never' }])
    await pi.harness.sendUser(t, 'go')
    await entered.promise
    const closing = pi.harness.close()
    // Long enough for close() to dispose the session if it did not stop the prompt first.
    await new Promise((resolve) => setTimeout(resolve, 20))
    gate.release()
    await closing
    // Long enough for a prompt close() left behind to reach the model.
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(pi.requests(t)).toEqual([])
    // The run ended, aborted, before its session was disposed.
    expect(atClose?.runEnd?.outcome).toBe('aborted')
    expect(disposed).toBe(1)
  })

  // Catches one session that fails to abort or dispose leaving the others undisposed, the harness open, or a failure
  // unreported.
  it('closes every conversation when one fails to abort and dispose', async () => {
    const closed: ThreadId[] = []
    let first = true
    const pi = await openPiHarness(
      (ports) =>
        ports.lifecycle.register({
          ...noLifecycle,
          onClose: async (thread) => {
            closed.push(thread)
          }
        }),
      [],
      async (request, open) => {
        const native = await open(request)
        if (!first) return native
        first = false
        const session = new Proxy(native.session, {
          get: (target, property) =>
            property === 'abort'
              ? () => Promise.reject(new Error('abort failed'))
              : Reflect.get(target, property, target)
        })
        return {
          ...native,
          session,
          dispose: async () => {
            await native.dispose()
            throw new Error('dispose failed')
          }
        }
      }
    )
    const a = await pi.harness.createThread()
    const b = await pi.harness.createThread()
    const failure: unknown = await pi.harness.close().catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AggregateError)
    expect((failure as AggregateError).errors.map((error: Error) => error.message)).toEqual([
      'abort failed',
      'dispose failed'
    ])
    expect(new Set(closed)).toEqual(new Set([a, b]))
    await expect(pi.harness.createThread()).rejects.toThrow('closed')
  })

  // Catches rule-handler errors Pi swallows never reaching onError: a failing omit sends the request unfiltered, a
  // failing before is just an error result, a failing after leaves the result unreplaced, a failing onClose is lost.
  it('reports what the rule handlers throw', async () => {
    const failures = {
      omit: new Error('omit failed'),
      before: new Error('before failed'),
      after: new Error('after failed'),
      close: new Error('onClose failed')
    }
    const pi = await openPiHarness((ports) => {
      ports.tools.register(tool('refused'))
      ports.tools.register(tool('replaced'))
      ports.contextFilter.register({
        omit: () => {
          throw failures.omit
        }
      })
      ports.toolGate.register({
        before: async (call) => {
          if (call.tool === 'refused') throw failures.before
          return {}
        },
        after: async (call) => {
          if (call.tool === 'replaced') throw failures.after
          return undefined
        }
      })
      ports.lifecycle.register({
        ...noLifecycle,
        onClose: async () => {
          throw failures.close
        }
      })
    })
    const t = await pi.harness.createThread()
    pi.harness.script(t, [
      {
        text: '',
        toolCalls: [
          { name: 'refused', args: {} },
          { name: 'replaced', args: {} }
        ]
      },
      { text: 'done' }
    ])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    await pi.harness.close()
    for (const failure of Object.values(failures)) expect(pi.errors).toContain(failure)
  })

  // Catches a gate's replacement leaving the tool's original structured output for a caller that runs the tool through
  // ctx.executeTool (codemode), which then reads what the gate replaced.
  it('drops the structured content of a result the gate replaced', async () => {
    let seen: unknown = 'not called'
    const parameters = { type: 'object', properties: {} } as unknown as TSchema
    const pi = await openPiHarness(
      (ports) =>
        ports.toolGate.register({
          before: async () => ({}),
          after: async (call) => (call.tool === 'structured' ? { text: 'replaced', isError: false } : undefined)
        }),
      [
        (api) => {
          api.registerTool({
            name: 'structured',
            label: 'structured',
            description: 'structured',
            parameters,
            execute: async () => ({
              content: [{ type: 'text', text: 'raw' }],
              details: {},
              structuredContent: { raw: true }
            })
          })
          api.registerTool({
            name: 'caller',
            label: 'caller',
            description: 'caller',
            parameters,
            async execute(_id, _params, _signal, _onUpdate, ctx) {
              seen = (await ctx.executeTool('structured', {})).result.structuredContent
              return { content: [{ type: 'text', text: 'called' }], details: {} }
            }
          })
        }
      ]
    )
    const t = await pi.harness.createThread()
    pi.harness.script(t, [{ text: '', toolCalls: [{ name: 'caller', args: {} }] }, { text: 'done' }])
    await pi.harness.sendUser(t, 'go')
    await pi.harness.settle()
    expect(seen).toBeUndefined()
  })
})
