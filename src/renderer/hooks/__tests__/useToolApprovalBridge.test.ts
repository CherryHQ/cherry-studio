/**
 * Regression for tool-approval-5: main signals failure via a resolved `{ ok: false }`.
 * The bridge must surface that (and hard IPC errors) as a rejection so the approval card
 * resets instead of being stuck "submitting" forever.
 */

import type { ToolApprovalMatch } from '@renderer/pages/home/Messages/Tools/toolResponse'
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useToolApprovalBridge } from '../useToolApprovalBridge'

const mocks = vi.hoisted(() => ({
  respondToolApproval: vi.fn()
}))

beforeEach(() => {
  respond.mockReset()
  ;(window as any).api = { ai: { toolApproval: { respond } } }
})

afterEach(() => {
  delete (window as any).api
})

const match = { messageId: 'a1', approvalId: 'ap-1', transport: 'mcp' } as ToolApprovalMatch

describe('useToolApprovalBridge', () => {
  beforeEach(() => {
    mocks.respondToolApproval.mockReset()
    mocks.respondToolApproval.mockResolvedValue({ ok: true })

    Object.defineProperty(window, 'api', {
      configurable: true,
      value: {
        ai: {
          toolApproval: {
            respond: mocks.respondToolApproval
          }
        }
      }
    })
  })

  it('delivers approval decisions to main with anchor context', async () => {
    const match = makeApprovalMatch()

    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).resolves.toBeUndefined()
    expect(respond).toHaveBeenCalledWith(
      expect.objectContaining({ approvalId: 'ap-1', anchorId: 'a1', approved: true })
    )
  })

  it('rejects when main returns { ok: false } so the card can reset (REGRESSION tool-approval-5)', async () => {
    respond.mockResolvedValueOnce({ ok: false })
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: true })).rejects.toThrow()
  })

  it('rejects when the IPC call itself throws (no longer swallowed)', async () => {
    respond.mockRejectedValueOnce(new Error('ipc boom'))
    const { result } = renderHook(() => useToolApprovalBridge('topic-1'))

    await expect(result.current({ match, approved: false })).rejects.toThrow('ipc boom')
  })
})
