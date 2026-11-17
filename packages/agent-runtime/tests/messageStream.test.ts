import { expect, it } from 'vitest'

import { RuntimeMessageStream } from '../src'

it('keeps interleaved content and tool progress in one immutable native message', async () => {
  const stream = new RuntimeMessageStream('native-message')
  const first = await stream.append(
    [
      { type: 'start-step' },
      { type: 'reasoning-start', id: 'thinking' },
      { type: 'reasoning-delta', id: 'thinking', delta: 'Plan' },
      { type: 'reasoning-end', id: 'thinking', providerMetadata: { anthropic: { signature: 'signed' } } },
      { type: 'text-start', id: 'before' },
      { type: 'text-delta', id: 'before', delta: 'Before' },
      { type: 'text-end', id: 'before' },
      { type: 'tool-input-start', toolCallId: 'call', toolName: 'Bash', dynamic: true },
      { type: 'tool-input-delta', toolCallId: 'call', inputTextDelta: '{"command":"pwd"}' },
      { type: 'tool-input-available', toolCallId: 'call', toolName: 'Bash', dynamic: true, input: { command: 'pwd' } },
      { type: 'tool-output-available', toolCallId: 'call', output: 'FIRST', preliminary: true }
    ],
    'partial'
  )
  expect(first.id).toBe('native-message')
  expect(first.parts.map((part) => part.type)).toEqual(['step-start', 'reasoning', 'text', 'dynamic-tool'])
  expect(first.parts[1]).toMatchObject({ text: 'Plan', providerMetadata: { anthropic: { signature: 'signed' } } })
  const last = await stream.append(
    [
      { type: 'tool-output-available', toolCallId: 'call', output: 'FIRST\nLAST', preliminary: false },
      { type: 'text-start', id: 'after' },
      { type: 'text-delta', id: 'after', delta: 'After' },
      { type: 'text-end', id: 'after' },
      { type: 'finish-step' },
      { type: 'finish' }
    ],
    'complete'
  )
  expect(last.id).toBe(first.id)
  expect(last.parts.map((part) => part.type)).toEqual(['step-start', 'reasoning', 'text', 'dynamic-tool', 'text'])
  expect(last.parts[3]).toMatchObject({
    toolCallId: 'call',
    state: 'output-available',
    output: 'FIRST\nLAST',
    preliminary: false
  })
  expect(first.parts[3]).toMatchObject({ output: 'FIRST', preliminary: true })
  expect(last.metadata).toEqual({ completeness: 'complete' })
  await stream.close()
})

it('serializes batches even when SDK control chunks emit no message', async () => {
  const stream = new RuntimeMessageStream('serial')
  const first = stream.append([{ type: 'start-step' }], 'partial')
  const second = stream.append(
    [
      { type: 'text-start', id: 'text' },
      { type: 'text-delta', id: 'text', delta: 'Kept' }
    ],
    'partial'
  )
  const final = stream.append(
    [{ type: 'text-end', id: 'text' }, { type: 'finish-step' }, { type: 'finish' }],
    'complete'
  )
  expect((await first).parts).toEqual([{ type: 'step-start' }])
  expect((await second).parts[1]).toMatchObject({ text: 'Kept', state: 'streaming' })
  expect((await final).parts[1]).toMatchObject({ text: 'Kept', state: 'done' })
  await stream.close()
  await expect(stream.append([], 'complete')).rejects.toThrow('closed')
})

it('rejects an invalid delta instead of hanging or silently dropping content', async () => {
  const stream = new RuntimeMessageStream('invalid')
  await expect(stream.append([{ type: 'text-delta', id: 'missing-start', delta: 'Lost' }], 'partial')).rejects.toThrow()
  await stream.close()
})
