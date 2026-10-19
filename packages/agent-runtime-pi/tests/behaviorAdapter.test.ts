import { describe, expect, it } from 'vitest'

import {
  type ChildSpec,
  type ConversationFacts,
  encodeEntry,
  type Key,
  type MessageResult,
  type TurnInput
} from '@cherrystudio/agent-behavior'
import type { ThreadId } from '@cherrystudio/agent-runtime'

import { openPiHarness, type PiHarness } from './behaviorHarness'

const read = (pi: PiHarness, thread: ThreadId): Promise<ConversationFacts> =>
  pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))

function latch() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => {
    release = resolve
  })
  return { promise, release }
}

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

  // Catches a message that reaches a child while Pi settles its run (after Pi's last steering check) being started by
  // Pi as a run of its own, stranded in Pi's queue, or answered with the end of the run it missed.
  it('carries a message that missed the run into the next run and answers it there', async () => {
    const sent = latch()
    let late: (() => Promise<MessageResult>) | undefined
    const admissions: MessageResult[] = []
    const pi = await openPiHarness(() => {}, [
      (api) => {
        api.on('agent_settled', async () => {
          const send = late
          late = undefined
          if (!send) return
          admissions.push(await send())
          sent.release()
        })
      }
    ])
    const parent = await pi.harness.createThread()
    const child = await spawn(pi, parent)
    pi.harness.script(child, [{ text: 'first' }, { text: 'second' }])
    late = () => pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('late'), key('late')))
    await pi.harness.withCall(parent, (ports) => ports.helpers.message(child, input('work'), key('work')))
    await sent.promise
    const answer = await pi.harness.withCall(parent, (ports) => ports.helpers.awaitAnswer(child, 1, key('late')))
    expect(admissions).toEqual([{ run: 1, status: 'queued' }])
    expect(answer).toEqual({ outcome: 'completed', text: 'second' })
    expect((await read(pi, parent)).children.get(child)?.runUsage).toHaveLength(2)
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
})
