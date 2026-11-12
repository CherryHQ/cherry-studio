import { retainNestedToolCall, type NestedToolCalls } from '@earendil-works/pi-ai'
import { expect, it } from 'vitest'

it('omits whole over-budget fields while preserving call outcome and other evidence', () => {
  const record = retainNestedToolCall(undefined, {
    id: 'outer/1',
    name: 'read',
    parentToolCallId: 'outer',
    status: 'ok',
    arguments: { text: '界'.repeat(3000) },
    result: { content: 'x'.repeat(65536) }
  })
  expect(record.calls[0]).toMatchObject({
    id: 'outer/1',
    status: 'ok',
    argumentsOmitted: 'budget',
    resultOmitted: 'budget'
  })
  expect(record.calls[0].arguments).toBeUndefined()
  expect(record.calls[0].result).toBeUndefined()
  expect(record.calls[0].argumentsBytes).toBeGreaterThan(8192)
  expect(record.complete).toBe(false)
  const next = retainNestedToolCall(record, {
    id: 'outer/2',
    name: 'read',
    status: 'error',
    arguments: {},
    result: { content: 'failure' },
    error: 'failure'
  })
  expect(next.calls[1]).toMatchObject({ arguments: {}, result: { content: 'failure' }, status: 'error' })
})

it('bounds aggregate retained payloads and reports calls beyond the count limit', () => {
  let records: NestedToolCalls | undefined
  for (let i = 0; i < 257; i++)
    records = retainNestedToolCall(records, {
      id: `outer/${i}`,
      name: 'read',
      status: 'ok',
      arguments: { text: 'x'.repeat(4000) },
      result: 'x'.repeat(60000)
    })
  expect(records!.calls).toHaveLength(256)
  expect(records!.omittedCalls).toBe(1)
  const bytes = (field: 'arguments' | 'result') =>
    records!.calls.reduce(
      (sum, call) => sum + (call[field] === undefined ? 0 : Buffer.byteLength(JSON.stringify(call[field]))),
      0
    )
  expect(bytes('arguments')).toBeLessThanOrEqual(32768)
  expect(bytes('result')).toBeLessThanOrEqual(1048576)
  expect(records!.calls.at(-1)).toMatchObject({ status: 'ok', argumentsOmitted: 'budget', resultOmitted: 'budget' })
})

it('does not invent a result for legacy evidence or leave interrupted calls running', async () => {
  const { projectNestedTool } = await import('@cherrystudio/agent-runtime')
  expect(projectNestedTool({ id: 'old', name: 'read', status: 'ok' })).toMatchObject({
    state: 'output-available',
    output: { content: [{ type: 'text', text: 'Tool completed; result was not retained.' }] },
    callProviderMetadata: { pi: { argumentsOmitted: true, resultOmitted: true } }
  })
  expect(projectNestedTool({ id: 'interrupted', name: 'bash', status: 'unfinished' })).toMatchObject({
    state: 'output-error',
    errorText: 'Tool execution was interrupted.'
  })
})
