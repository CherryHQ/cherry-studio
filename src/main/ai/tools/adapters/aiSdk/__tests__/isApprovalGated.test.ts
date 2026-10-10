import type { Tool } from 'ai'
import { describe, expect, it } from 'vitest'

import { isApprovalGated } from '../isApprovalGated'

function toolWith(needsApproval?: Tool['needsApproval']): Tool {
  return {
    type: 'function',
    description: 't',
    inputSchema: {},
    ...(needsApproval !== undefined ? { needsApproval } : {})
  } as unknown as Tool
}

describe('isApprovalGated', () => {
  it('returns false when no needsApproval is declared', async () => {
    expect(await isApprovalGated(toolWith())).toBe(false)
  })

  it('honors a boolean needsApproval', async () => {
    expect(await isApprovalGated(toolWith(true))).toBe(true)
    expect(await isApprovalGated(toolWith(false))).toBe(false)
  })

  it('awaits a function needsApproval and passes input + options through', async () => {
    let seen: unknown
    const tool = toolWith(async (input, options) => {
      seen = { input, options }
      return true
    })
    expect(await isApprovalGated(tool, { input: { a: 1 }, toolCallId: 'c1', messages: [] })).toBe(true)
    expect(seen).toEqual({
      input: { a: 1 },
      options: { toolCallId: 'c1', messages: [], experimental_context: undefined }
    })
  })

  it('fails closed (returns true) when needsApproval throws', async () => {
    const tool = toolWith(async () => {
      throw new Error('policy boom')
    })
    expect(await isApprovalGated(tool)).toBe(true)
  })
})
