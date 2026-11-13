import { expect, it } from 'vitest'

import { openPiHarness } from './behaviorHarness'

it('ends a refused request without calling the provider and allows a later admitted request', async () => {
  let allowed = false
  const pi = await openPiHarness((ports) => {
    ports.requestMeter.register({
      allow: () => (allowed ? { ok: true } : { ok: false, text: 'request cap reached' })
    })
  })
  const thread = await pi.harness.createThread()
  pi.harness.script(thread, [{ text: 'Admitted answer' }])
  await pi.harness.sendUser(thread, 'Refused request')
  await pi.harness.settle()
  expect(pi.requests(thread)).toHaveLength(0)
  const facts = await pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))
  expect(facts.history.at(-1)).toMatchObject({
    kind: 'assistant',
    stop: 'error',
    error: 'request cap reached'
  })
  allowed = true
  await pi.harness.sendUser(thread, 'Admitted request')
  await pi.harness.settle()
  expect(pi.requests(thread)).toHaveLength(1)
  const admitted = await pi.harness.withCall(thread, (ports) => ports.ledger.read(thread))
  expect(admitted.history.at(-1)).toMatchObject({ kind: 'assistant', text: 'Admitted answer', stop: 'stop' })
  expect(pi.errors).toEqual([])
})
