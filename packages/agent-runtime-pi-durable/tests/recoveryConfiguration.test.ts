import { expect, it } from 'vitest'

import type { Key } from '@cherrystudio/agent-behavior'
import type { ThreadId } from '@cherrystudio/agent-runtime'

import { openDurableHarness } from './behaviorHarness'

it('applies a recovered child model binding before its next native request', async () => {
  const binding: { thread?: ThreadId } = {}
  const h = await openDurableHarness(() => {}, [], {
    configureChild: (_child, parent) => ({
      model: { provider: `thread-${binding.thread ?? parent}`, modelId: 'faux-1' }
    })
  })
  const parent = await h.harness.createThread()
  const replacement = await h.harness.createThread()
  const created = await h.harness.withCall(parent, (ports) =>
    ports.ledger.transact(parent, () => ({
      ops: [
        {
          type: 'spawn-child',
          key: 'child' as Key,
          spec: {
            boundary: 'background',
            origin: { parentToolCallId: 'spawn', fork: false, description: 'Child', modelKey: 'original' },
            record: {
              parentToolCallId: 'spawn',
              fork: false,
              description: 'Child',
              modelKey: 'original',
              background: true,
              run: 1,
              status: 'running'
            }
          }
        }
      ],
      effects: [],
      result: null
    }))
  )
  const child = created.spawned[0].child
  h.harness.script(parent, [{ text: 'Original model answer' }])
  await h.harness.sendUser(child, 'First request')
  await h.harness.settle()
  binding.thread = replacement
  await h.harness.restart()
  h.harness.script(replacement, [{ text: 'Rebound model answer' }])
  await h.harness.sendUser(child, 'After reopen')
  await h.harness.settle()
  const facts = await h.harness.withCall(child, (ports) => ports.ledger.read(child))
  expect(facts.history.filter((entry) => entry.kind === 'assistant').map((entry) => entry.text)).toEqual([
    'Original model answer',
    'Rebound model answer'
  ])
  expect(h.errors).toEqual([])
})
