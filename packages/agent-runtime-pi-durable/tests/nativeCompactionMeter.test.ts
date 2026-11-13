import { expect, it } from 'vitest'

import { openDurableHarness } from './behaviorHarness'

// Catches native completeSimple bypassing the request limit during compaction.
it('checks the request limit before a native compaction summary reaches the model', async () => {
  let allow = true
  const h = await openDurableHarness((ports) => {
    ports.requestMeter.register({
      allow: () => (allow ? { ok: true } : { ok: false, text: 'request limit reached' })
    })
  })
  const thread = await h.harness.createThread()
  h.harness.script(thread, [{ text: 'Earlier answer '.repeat(100) }, { text: 'Current answer' }, { text: 'Summary' }])
  await h.harness.sendUser(thread, 'Earlier request '.repeat(100))
  await h.harness.settle()
  await h.harness.sendUser(thread, 'Current request')
  await h.harness.settle()

  const history = async () => (await h.harness.withCall(thread, (ports) => ports.ledger.read(thread))).history
  allow = false
  await h.harness.compact(thread)
  expect((await history()).some((entry) => entry.kind === 'compaction')).toBe(false)

  allow = true
  await h.harness.compact(thread)
  expect((await history()).some((entry) => entry.kind === 'compaction')).toBe(true)
})

it('keeps request counts with their originating run after a newer run starts and after restart', async () => {
  const seen: number[] = []
  const h = await openDurableHarness((ports) => {
    ports.requestMeter.register({
      allow: (_thread, requests) => {
        seen.push(requests)
        return { ok: true }
      }
    })
  })
  const thread = await h.harness.createThread()
  await h.behavior().consumeRequest(thread, 11)
  await h.behavior().consumeRequest(thread, 11)
  await h.behavior().consumeRequest(thread, 12)
  await h.behavior().consumeRequest(thread, 11)
  await h.harness.restart()
  await h.behavior().consumeRequest(thread, 11)
  expect(seen).toEqual([0, 1, 0, 2, 3])
})
