import { MigrationIpcChannels, type MigrationProgress } from '@shared/data/migration/v2/types'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { useMigrationProgress } from '../useMigrationProgress'

const cleanup = vi.fn()
const invoke = vi.fn()
const on = vi.fn()
const removeAllListeners = vi.fn()

function makeProgress(stage: MigrationProgress['stage'], patch: Partial<MigrationProgress> = {}): MigrationProgress {
  return {
    currentMessage: stage,
    migrators: [],
    overallProgress: 0,
    stage,
    ...patch
  }
}

describe('useMigrationProgress', () => {
  let progressHandler: ((event: unknown, progress: MigrationProgress) => void) | undefined
  let now = 0

  beforeEach(async () => {
    cleanup.mockClear()
    invoke.mockReset()
    on.mockReset()
    removeAllListeners.mockClear()
    progressHandler = undefined
    now = 0

    vi.spyOn(performance, 'now').mockImplementation(() => now)

    invoke.mockImplementation((channel: string) => {
      if (channel === MigrationIpcChannels.GetProgress) {
        return Promise.resolve(makeProgress('introduction'))
      }
      if (channel === MigrationIpcChannels.GetLastError) {
        return Promise.resolve(null)
      }
      return Promise.resolve(undefined)
    })

    on.mockImplementation((channel: string, handler: (event: unknown, progress: MigrationProgress) => void) => {
      if (channel === MigrationIpcChannels.Progress) {
        progressHandler = handler
      }
      return cleanup
    })

    ;(window as unknown as { electron: { ipcRenderer: unknown } }).electron = {
      ipcRenderer: {
        invoke,
        on,
        removeAllListeners
      }
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('uses the migration-stage visible duration for the completion summary', async () => {
    const { result } = renderHook(() => useMigrationProgress())
    await waitFor(() => expect(progressHandler).toBeDefined())

    now = 1_000
    act(() => {
      progressHandler?.(null, makeProgress('migration', { overallProgress: 10 }))
    })

    now = 7_600
    act(() => {
      progressHandler?.(
        null,
        makeProgress('completed', {
          overallProgress: 100,
          summary: {
            completedMigrators: 15,
            durationMs: 4_200,
            itemsProcessed: 3_353,
            totalMigrators: 15
          }
        })
      )
    })

    expect(result.current.progress.summary?.durationMs).toBe(6_600)
  })

  it('resets the migration-stage timer for a retry and reports the final successful attempt', async () => {
    const { result } = renderHook(() => useMigrationProgress())
    await waitFor(() => expect(progressHandler).toBeDefined())

    now = 1_000
    act(() => {
      progressHandler?.(null, makeProgress('migration'))
    })

    now = 3_000
    act(() => {
      progressHandler?.(null, makeProgress('error', { error: 'failed' }))
    })

    now = 5_000
    act(() => {
      progressHandler?.(null, makeProgress('migration'))
    })

    now = 8_250
    act(() => {
      progressHandler?.(
        null,
        makeProgress('completed', {
          summary: {
            completedMigrators: 15,
            durationMs: 99_999,
            itemsProcessed: 3_353,
            totalMigrators: 15
          }
        })
      )
    })

    expect(result.current.progress.summary?.durationMs).toBe(3_250)
  })
})
