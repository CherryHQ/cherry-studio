import type { ToastAction, ToastConfig } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import i18n, { initI18n } from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  showRecycleBinBatchUndo,
  showRecycleBinUndo
} from '../recycleBinFeedback'

function getInitialToastConfig(): ToastConfig {
  const config = vi.mocked(toast.success).mock.calls[0]?.[0]

  if (!config || typeof config === 'string') {
    throw new Error('expected an initial toast config')
  }

  return config
}

function getUndoAction(): ToastAction {
  const action = getInitialToastConfig().action

  if (!action) {
    throw new Error('expected an undo action')
  }

  return action
}

describe('recycleBinFeedback', () => {
  beforeAll(async () => {
    await initI18n()
    await i18n.changeLanguage('en-US')
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows a five-second undo toast and invokes the supplied restore once', async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined)

    showRecycleBinUndo({ itemName: 'Draft', onUndo })

    expect(getInitialToastConfig()).toMatchObject({
      action: { label: 'Undo' },
      timeout: 5000,
      title: 'Draft moved to Recycle Bin'
    })

    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('reports a successful single-item restore', async () => {
    showRecycleBinUndo({ itemName: 'Draft', onUndo: vi.fn().mockResolvedValue(undefined) })

    await getUndoAction().onClick()

    expect(toast.success).toHaveBeenNthCalledWith(2, 'Restored from Recycle Bin')
  })

  it('logs and reports a rejected single-item restore without leaking the rejection', async () => {
    const error = new Error('stale')
    const loggerError = vi.spyOn(loggerService.withContext('recycleBinFeedback'), 'error').mockImplementation(() => {})

    showRecycleBinUndo({ itemName: 'Draft', onUndo: vi.fn().mockRejectedValue(error) })

    await expect(getUndoAction().onClick()).resolves.toBeUndefined()

    expect(loggerError).toHaveBeenCalledWith('Recycle Bin undo failed', error)
    expect(toast.error).toHaveBeenCalledWith('Failed to restore from Recycle Bin')
  })

  it('reports the restored and failed counts for a fully successful batch', async () => {
    const onUndo = vi.fn().mockResolvedValue({ restored: ['topic-a', 'topic-b'], failed: [] })

    showRecycleBinBatchUndo({ itemCount: 2, onUndo })

    expect(getInitialToastConfig()).toMatchObject({
      action: { label: 'Undo' },
      timeout: 5000,
      title: 'Moved to Recycle Bin: 2'
    })

    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Restore result — succeeded: 2, failed: 0')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('uses a count-neutral moved label for a one-item batch', () => {
    showRecycleBinBatchUndo({ itemCount: 1, onUndo: vi.fn() })

    const title = getInitialToastConfig().title

    expect(title).toBe('Moved to Recycle Bin: 1')
    expect(title).not.toContain('1 items')
  })

  it('warns with the restored and failed counts for a partially failed batch', async () => {
    const onUndo = vi.fn().mockResolvedValue({
      restored: ['topic-a'],
      failed: [{ id: 'topic-b', error: 'stale' }]
    })

    showRecycleBinBatchUndo({ itemCount: 2, onUndo })
    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
    expect(toast.warning).toHaveBeenCalledWith('Restore result — succeeded: 1, failed: 1')
  })

  it('logs and reports an unexpected batch rejection without leaking it', async () => {
    const error = new Error('request failed')
    const loggerError = vi.spyOn(loggerService.withContext('recycleBinFeedback'), 'error').mockImplementation(() => {})
    const onUndo = vi.fn().mockRejectedValue(error)

    showRecycleBinBatchUndo({ itemCount: 2, onUndo })

    await expect(getUndoAction().onClick()).resolves.toBeUndefined()

    expect(onUndo).toHaveBeenCalledOnce()
    expect(loggerError).toHaveBeenCalledWith('Recycle Bin batch undo failed', error)
    expect(toast.error).toHaveBeenCalledWith('Failed to restore from Recycle Bin')
  })

  it('counts a concurrent restore as complete only when the active endpoint finds the item', async () => {
    const activeError = DataApiErrorFactory.notFound('Topic', 'topic-active')
    const missingError = DataApiErrorFactory.notFound('Topic', 'topic-missing')
    const restore = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(activeError)
      .mockRejectedValueOnce(missingError)
    const getActive = vi
      .fn()
      .mockResolvedValueOnce({ id: 'topic-active' })
      .mockRejectedValueOnce(DataApiErrorFactory.notFound('Topic', 'topic-missing'))
    const refresh = vi.fn().mockRejectedValue(new Error('refresh failed'))
    const loggerWarn = vi.spyOn(loggerService.withContext('recycleBinFeedback'), 'warn').mockImplementation(() => {})

    await expect(
      restoreRecycleBinItems({
        ids: ['topic-restored', 'topic-active', 'topic-missing'],
        restore,
        getActive,
        refresh
      })
    ).resolves.toEqual({
      restored: ['topic-restored', 'topic-active'],
      failed: [{ id: 'topic-missing', error: missingError.message }]
    })

    expect(getActive).toHaveBeenNthCalledWith(1, 'topic-active')
    expect(getActive).toHaveBeenNthCalledWith(2, 'topic-missing')
    expect(refresh).toHaveBeenCalledOnce()
    expect(loggerWarn).toHaveBeenCalledWith('Failed to refresh after Recycle Bin restore', expect.any(Error))
  })

  it('does not probe the active endpoint for ordinary restore failures', async () => {
    const restoreError = new Error('restore failed')
    const getActive = vi.fn()
    const refresh = vi.fn().mockResolvedValue(undefined)

    await expect(
      restoreRecycleBinItem({
        id: 'topic-a',
        restore: vi.fn().mockRejectedValue(restoreError),
        getActive,
        refresh
      })
    ).rejects.toThrow('restore failed')

    expect(getActive).not.toHaveBeenCalled()
    expect(refresh).toHaveBeenCalledOnce()
  })
})
