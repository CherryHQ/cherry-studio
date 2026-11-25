import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useMessageAuthorAvatarSources } from '@renderer/components/chat/messages/hooks/useMessageAuthorAvatarSources'
import type { MessageListItem } from '@renderer/components/chat/messages/types'
import { ipcApi } from '@renderer/ipc'
import type { FileEntryId } from '@shared/data/types/file'
import type { AbsoluteFilePath } from '@shared/types/file'

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))

const id = (value: number): FileEntryId => `file:${value}`
function message(value: number, topicId = 'topic-1'): MessageListItem {
  return {
    id: `message-${value}`,
    topicId,
    role: 'assistant',
    status: 'success',
    createdAt: '',
    messageSnapshot: {
      id: 'assistant-1',
      name: 'Assistant',
      model: { id: 'model', name: 'Model', provider: 'provider' },
      emoji: '🤖',
      avatarFileId: id(value)
    }
  }
}

beforeEach(() => {
  vi.mocked(ipcApi.request).mockReset()
})

describe('frozen message avatar sources', () => {
  it('deduplicates, batches at 500, and requests only newly encountered ids', async () => {
    vi.mocked(ipcApi.request).mockImplementation(
      async (_route, input) =>
        Object.fromEntries((input as { ids: string[] }).ids.map((key) => [key, '/images/avatar.webp'])) as never
    )
    const messages = Array.from({ length: 501 }, (_, index) => message(index))
    const { result, rerender } = renderHook(({ items }) => useMessageAuthorAvatarSources(items), {
      initialProps: { items: [...messages, messages[0]] }
    })
    await waitFor(() => expect(result.current.size).toBe(501))
    expect(ipcApi.request).toHaveBeenCalledTimes(2)
    expect(vi.mocked(ipcApi.request).mock.calls.map(([, input]) => (input as { ids: string[] }).ids.length)).toEqual([
      500, 1
    ])
    expect(result.current.get(id(0))).toBe('file:///images/avatar.webp')
    rerender({ items: [...messages, message(501)] })
    await waitFor(() => expect(result.current.size).toBe(502))
    expect(ipcApi.request).toHaveBeenLastCalledWith('file.batch_get_physical_paths', { ids: [id(501)] })
    rerender({ items: [message(0)] })
    expect(ipcApi.request).toHaveBeenCalledTimes(3)
  })

  it('does not request empty lists or messages without image snapshots', () => {
    const { rerender } = renderHook(({ items }) => useMessageAuthorAvatarSources(items), {
      initialProps: { items: [] as MessageListItem[] }
    })
    rerender({ items: [{ ...message(0), messageSnapshot: undefined }] })
    expect(ipcApi.request).not.toHaveBeenCalled()
  })

  it('omits missing files and tolerates rejected batches', async () => {
    vi.mocked(ipcApi.request)
      .mockResolvedValueOnce({ [id(0)]: null, [id(1)]: '/image.webp' })
      .mockRejectedValueOnce(new Error('Unavailable'))
    const { result, rerender } = renderHook(({ items }) => useMessageAuthorAvatarSources(items), {
      initialProps: { items: [message(0), message(1)] }
    })
    await waitFor(() => expect(result.current.get(id(1))).toBe('file:///image.webp'))
    expect(result.current.has(id(0))).toBe(false)
    rerender({ items: [message(0), message(1), message(2)] })
    await act(async () => {
      await Promise.resolve()
    })
    expect(result.current.has(id(2))).toBe(false)
    expect(result.current.size).toBe(1)
  })

  it('drops an old topic response even when the new topic has the same file id', async () => {
    let finish!: (paths: Record<string, AbsoluteFilePath>) => void
    vi.mocked(ipcApi.request)
      .mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve
        }) as never
      )
      .mockResolvedValueOnce({ [id(1)]: '/new.webp' })
    const { result, rerender } = renderHook(({ items }) => useMessageAuthorAvatarSources(items), {
      initialProps: { items: [message(0)] }
    })
    rerender({ items: [message(0, 'topic-2'), message(1, 'topic-2')] })
    await waitFor(() => expect(result.current.get(id(1))).toBe('file:///new.webp'))
    await act(async () => finish({ [id(0)]: '/old.webp' as AbsoluteFilePath }))
    expect(result.current.has(id(0))).toBe(false)
    expect(result.current.size).toBe(1)
  })
})
