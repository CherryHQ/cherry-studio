import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  invalidate: vi.fn(),
  request: vi.fn()
}))

vi.mock('@renderer/data/hooks/useDataApi', () => ({
  useInvalidateCache: () => mocks.invalidate
}))

vi.mock('@renderer/ipc', () => ({
  ipcApi: { request: mocks.request }
}))

import { useEntityAvatar } from '../useEntityAvatar'

describe('useEntityAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.invalidate.mockResolvedValue(undefined)
  })

  it('writes an assistant image and invalidates every assistant avatar surface', async () => {
    const updated = {
      id: 'assistant-1',
      avatar: { kind: 'image', fileId: '019606a0-0000-7000-8000-000000000001', src: 'file:///avatar.png' }
    }
    mocks.request.mockResolvedValue(updated)
    const bytes = new Uint8Array([1, 2, 3])
    const { result } = renderHook(() => useEntityAvatar())

    await act(async () => {
      await result.current.setAssistantAvatar('assistant-1', { kind: 'image', data: bytes })
    })

    expect(mocks.request).toHaveBeenCalledWith('assistant.set_avatar', {
      assistantId: 'assistant-1',
      avatar: { kind: 'image', data: expect.any(Uint8Array) }
    })
    expect(mocks.request.mock.calls[0][1].avatar.data).not.toBe(bytes)
    expect(mocks.invalidate).toHaveBeenCalledWith(['/assistants', '/assistants/*', '/search/entities'])
  })

  it('writes an agent emoji and invalidates every agent avatar surface', async () => {
    mocks.request.mockResolvedValue({ id: 'agent-1', avatar: { kind: 'emoji', emoji: '🦞' } })
    const { result } = renderHook(() => useEntityAvatar())

    await act(async () => {
      await result.current.setAgentAvatar('agent-1', { kind: 'emoji', emoji: '🦞' })
    })

    expect(mocks.request).toHaveBeenCalledWith('agent.set_avatar', {
      agentId: 'agent-1',
      avatar: { kind: 'emoji', emoji: '🦞' }
    })
    expect(mocks.invalidate).toHaveBeenCalledWith(['/agents', '/agents/*', '/search/entities'])
  })
})
