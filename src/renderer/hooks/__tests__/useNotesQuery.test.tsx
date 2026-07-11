import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { SWRConfig } from 'swr'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useFileContent, useFileContentSync } from '../useNotesQuery'

const readExternal = vi.fn()

// Isolate SWR's global cache per render so content does not bleed across tests.
const wrapper = ({ children }: { children: ReactNode }) => (
  <SWRConfig value={{ provider: () => new Map(), dedupingInterval: 0 }}>{children}</SWRConfig>
)

describe('useNotesQuery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    readExternal.mockResolvedValue('file content')
    ;(window as unknown as { api: { file: { readExternal: typeof readExternal } } }).api = {
      file: { readExternal }
    }
  })

  describe('useFileContent', () => {
    it('does not read when no file path is supplied (null SWR key)', async () => {
      const { result } = renderHook(() => useFileContent(undefined), { wrapper })

      await act(async () => {
        await Promise.resolve()
      })

      expect(readExternal).not.toHaveBeenCalled()
      expect(result.current.data).toBeUndefined()
    })

    it('reads the external file content for the active path', async () => {
      const { result } = renderHook(() => useFileContent('/notes/a.md'), { wrapper })

      await waitFor(() => expect(result.current.data).toBe('file content'))
      expect(readExternal).toHaveBeenCalledWith('/notes/a.md')
    })

    it('surfaces read errors through SWR error', async () => {
      const error = new Error('read failed')
      readExternal.mockRejectedValue(error)

      const { result } = renderHook(() => useFileContent('/notes/broken.md'), { wrapper })

      await waitFor(() => expect(result.current.error).toBe(error))
    })
  })

  describe('useFileContentSync', () => {
    it('re-reads the active file content when invalidated', async () => {
      const { result } = renderHook(() => ({ content: useFileContent('/notes/a.md'), sync: useFileContentSync() }), {
        wrapper
      })

      await waitFor(() => expect(result.current.content.data).toBe('file content'))
      expect(readExternal).toHaveBeenCalledTimes(1)

      readExternal.mockResolvedValue('updated content')
      await act(async () => {
        result.current.sync.invalidateFileContent('/notes/a.md')
      })

      await waitFor(() => expect(result.current.content.data).toBe('updated content'))
      expect(readExternal).toHaveBeenCalledTimes(2)
    })
  })
})
