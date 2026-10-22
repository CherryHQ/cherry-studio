import { MockUseCacheUtils } from '@test-mocks/renderer/useCache'
import { renderHook, waitFor } from '@testing-library/react'
import type { PropsWithChildren } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ExternalOpenTargetResult } from '@shared/types/externalApp'

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  open: vi.fn()
}))

vi.mock('@renderer/services/externalOpenTargetService', () => ({
  externalOpenTargetService: { list: mocks.list, open: mocks.open },
  getExternalOpenTargetScope: (_targetPath: string, pathKind: 'file' | 'directory') =>
    pathKind === 'directory' ? 'directory' : 'file:md'
}))

import { useExternalOpenTargets, usePreferredExternalOpenTarget } from '../useExternalOpenTargets'

const result: ExternalOpenTargetResult = {
  pathKind: 'file',
  recommendedTargetId: 'file_manager',
  targets: [
    { id: 'system_default', kind: 'system_default' },
    { id: 'file_manager', kind: 'file_manager' }
  ]
}

function TestSWRConfig({ children }: PropsWithChildren) {
  return <SWRConfig value={{ provider: () => new Map() }}>{children}</SWRConfig>
}

describe('usePreferredExternalOpenTarget', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockUseCacheUtils.resetMocks()
    mocks.list.mockResolvedValue(result)
  })

  it('queries same-extension files independently and preserves their own target lists', async () => {
    const firstResult = {
      ...result,
      targets: [{ id: 'system_default', kind: 'system_default' as const, name: 'Code' }]
    }
    const secondResult = {
      ...result,
      targets: [
        { id: 'system_default', kind: 'system_default' as const, name: 'Other' },
        { id: 'known:vscode', kind: 'application' as const, name: 'Visual Studio Code' }
      ]
    }
    mocks.list.mockImplementation(async (targetPath: string) =>
      targetPath === '/tmp/a.md' ? firstResult : secondResult
    )

    const { result: hook } = renderHook(
      () => ({
        first: useExternalOpenTargets('/tmp/a.md', 'file'),
        second: useExternalOpenTargets('/tmp/b.md', 'file')
      }),
      { wrapper: TestSWRConfig }
    )

    await waitFor(() => {
      expect(hook.current.first.data).toEqual(firstResult)
      expect(hook.current.second.data).toEqual(secondResult)
    })
    expect(mocks.list).toHaveBeenCalledTimes(2)
    expect(mocks.list).toHaveBeenCalledWith('/tmp/a.md', 'file')
    expect(mocks.list).toHaveBeenCalledWith('/tmp/b.md', 'file')
  })

  it('falls back to the recommended target when the persisted target is stale', async () => {
    MockUseCacheUtils.setPersistCacheValue('external_app.target.preferences', { 'file:md': 'known:missing' })

    const { result: hook } = renderHook(() => usePreferredExternalOpenTarget('/tmp/README.md', 'file'), {
      wrapper: TestSWRConfig
    })

    await waitFor(() => expect(hook.current.selectedTarget?.id).toBe('file_manager'))
  })

  it('falls back to the first available target when the recommendation is unavailable', async () => {
    mocks.list.mockResolvedValue({ ...result, recommendedTargetId: 'known:missing' })

    const { result: hook } = renderHook(() => usePreferredExternalOpenTarget('/tmp/README.md', 'file'), {
      wrapper: TestSWRConfig
    })

    await waitFor(() => expect(hook.current.selectedTarget?.id).toBe('system_default'))
  })
})
