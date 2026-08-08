import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { requestMock } = vi.hoisted(() => ({ requestMock: vi.fn() }))

vi.mock('@renderer/ipc', () => ({ ipcApi: { request: requestMock } }))
vi.mock('@logger', () => ({
  loggerService: { withContext: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) }
}))

import { useFileProcessorConnectivity } from '../useFileProcessorConnectivity'

const renderProbe = () => renderHook(() => useFileProcessorConnectivity('open-mineru', 'document_to_markdown'))

beforeEach(() => {
  vi.clearAllMocks()
})

describe('useFileProcessorConnectivity', () => {
  it('starts optimistic and unresolved so a working host never flickers', () => {
    requestMock.mockReturnValue(new Promise(() => undefined))

    const { result } = renderProbe()

    expect(result.current).toEqual({ reachable: true, isResolved: false })
    expect(requestMock).toHaveBeenCalledWith('file_processing.processor.check_connectivity', {
      processorId: 'open-mineru',
      feature: 'document_to_markdown'
    })
  })

  it('reports the verdict once the probe answers', async () => {
    requestMock.mockResolvedValue(false)

    const { result } = renderProbe()

    await waitFor(() => expect(result.current).toEqual({ reachable: false, isResolved: true }))
  })

  // The route answers false for an unreachable host, so a rejection is our own bug.
  // Resolving as unreachable would grey out a processor on no evidence at all.
  it('resolves reachable when the probe itself breaks', async () => {
    requestMock.mockRejectedValue(new Error('ipc exploded'))

    const { result } = renderProbe()

    await waitFor(() => expect(result.current).toEqual({ reachable: true, isResolved: true }))
  })

  it('ignores a late answer after unmount', async () => {
    let settle!: (reachable: boolean) => void
    requestMock.mockReturnValue(
      new Promise<boolean>((resolve) => {
        settle = resolve
      })
    )

    const { result, unmount } = renderProbe()
    unmount()
    settle(false)
    await Promise.resolve()

    expect(result.current).toEqual({ reachable: true, isResolved: false })
  })
})
