import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import type { FollowupQueueItem } from '../../../useFollowupQueue'
import { useSteerQueuedFollowup } from '../useQueuedFollowupSteer'

const payload = (text: string) => ({ text, userMessageParts: [{ type: 'text', text }] }) as any
const item = (id: string, text: string): FollowupQueueItem => ({
  id,
  draft: { text, tokens: [] as any[] },
  payload: payload(text)
})

const setup = (items: FollowupQueueItem[]) => {
  const tryClaimSend = vi.fn().mockReturnValue(true)
  const releaseSend = vi.fn()
  const removeFollowup = vi.fn()
  const sendPayload = vi.fn().mockResolvedValue(true)
  const { result, rerender } = renderHook(
    ({ liveItems }: { liveItems: FollowupQueueItem[] }) =>
      useSteerQueuedFollowup({ items: liveItems, tryClaimSend, releaseSend, removeFollowup, sendPayload }),
    { initialProps: { liveItems: items } }
  )
  return { result, rerender, tryClaimSend, releaseSend, removeFollowup, sendPayload }
}

describe('useSteerQueuedFollowup', () => {
  it('claims the send slot, sends, and dequeues on success', async () => {
    const { result, tryClaimSend, releaseSend, removeFollowup, sendPayload } = setup([item('a', 'first')])

    await act(async () => {
      await result.current('a')
    })

    expect(tryClaimSend).toHaveBeenCalledWith('a')
    expect(sendPayload).toHaveBeenCalledWith(payload('first'))
    expect(removeFollowup).toHaveBeenCalledWith('a')
    expect(releaseSend).toHaveBeenCalledWith('a')
  })

  it('keeps the item queued when the send fails but still releases the claim', async () => {
    const { result, releaseSend, removeFollowup, sendPayload } = setup([item('a', 'first')])
    sendPayload.mockResolvedValue(false)

    await act(async () => {
      await result.current('a')
    })

    expect(removeFollowup).not.toHaveBeenCalled()
    expect(releaseSend).toHaveBeenCalledWith('a')
  })

  it('ignores a re-entrant steer while one is in flight', async () => {
    const { result, removeFollowup, sendPayload } = setup([item('a', 'first')])
    let resolveSend!: (sent: boolean) => void
    sendPayload.mockImplementationOnce(() => new Promise<boolean>((resolve) => (resolveSend = resolve)))

    let first!: Promise<void>
    act(() => {
      first = result.current('a')
    })
    await act(async () => {
      await result.current('a')
    })
    await act(async () => {
      resolveSend(true)
      await first
    })

    expect(sendPayload).toHaveBeenCalledTimes(1)
    expect(removeFollowup).toHaveBeenCalledWith('a')
  })

  it('does not send when the queue denies the claim', async () => {
    const { result, releaseSend, sendPayload, tryClaimSend } = setup([item('a', 'first')])
    tryClaimSend.mockReturnValue(false)

    await act(async () => {
      await result.current('a')
    })

    expect(sendPayload).not.toHaveBeenCalled()
    expect(releaseSend).not.toHaveBeenCalled()
  })

  it('looks up the item in the latest items', async () => {
    const { result, rerender, sendPayload } = setup([item('a', 'first')])

    rerender({ liveItems: [item('b', 'second')] })
    await act(async () => {
      await result.current('b')
    })

    expect(sendPayload).toHaveBeenCalledWith(payload('second'))
  })
})
