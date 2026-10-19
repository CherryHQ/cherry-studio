import { describe, expect, it } from 'vitest'

import type { ConversationFacts } from '@cherrystudio/agent-behavior'
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
})
