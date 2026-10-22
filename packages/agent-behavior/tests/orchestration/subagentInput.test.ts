import { expect, it } from 'vitest'

import { assistantTexts, callTool, reply } from '../../src/contract/fixtures'
import { markers, records, world } from './world'

// Catches the host entry starting a raw child run, or a retried request creating another continuation and report.
it('continues the exact child once for a repeated host request', async () => {
  const w = world({
    scripts: (_thread, lineage) =>
      lineage.kind === 'subagent' ? [reply('first answer'), reply('continued answer')] : []
  })
  const parent = await w.fake.createThread()
  w.fake.script(parent, [
    callTool('subagent', { description: 'scan', prompt: 'scan' }),
    reply('parent done'),
    reply('result received')
  ])
  await w.fake.sendUser(parent, 'delegate')
  await w.fake.settle()
  const child = [...(await w.read(parent)).children.keys()][0]
  const signal = new AbortController().signal
  const send = () =>
    w.enter(child, (entries, ports) => entries.messageSubagent(ports, child, 'continue', 'request', signal))
  expect(await send()).toEqual({ status: 'continued', child })
  expect(await send()).toEqual({ status: 'continued', child })
  await w.fake.settle()
  const facts = await w.read(parent)
  expect([...facts.children.keys()]).toEqual([child])
  expect(
    records(facts, 'subagent-run').filter(({ value }) => value.run === 2 && value.status === 'running')
  ).toHaveLength(1)
  expect(markers(facts, 'subagent-notification')).toHaveLength(1)
  expect(assistantTexts(await w.read(child))).toEqual(['first answer', 'continued answer'])
})

// Catches accepting a root as a child or writing continuation state for a cancelled host request.
it('refuses a root and an already cancelled child input without starting work', async () => {
  const w = world({ scripts: (_thread, lineage) => (lineage.kind === 'subagent' ? [reply('first answer')] : []) })
  const parent = await w.fake.createThread()
  w.fake.script(parent, [callTool('subagent', { description: 'scan', prompt: 'scan' }), reply('parent done')])
  await w.fake.sendUser(parent, 'delegate')
  await w.fake.settle()
  const child = [...(await w.read(parent)).children.keys()][0]
  const signal = AbortSignal.abort()
  for (const target of [parent, child])
    expect(
      await w.enter(target, (entries, ports) => entries.messageSubagent(ports, target, 'continue', 'request', signal))
    ).toMatchObject({ status: 'refused' })
  expect(records(await w.read(parent), 'subagent-run').every(({ value }) => value.run === 1)).toBe(true)
  expect(assistantTexts(await w.read(child))).toEqual(['first answer'])
})
