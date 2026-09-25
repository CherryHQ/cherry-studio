import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import type { ToastAction, ToastConfig } from '@cherrystudio/ui'
import { loggerService } from '@logger'
import i18n, { initI18n } from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { DataApiErrorFactory } from '@shared/data/api/errors'

import {
  restoreRecycleBinItem,
  restoreRecycleBinItems,
  restoreRecycleBinUndoGroup,
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
      title: 'Draft moved to Archive'
    })

    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
  })

  it('reports a successful single-item restore', async () => {
    showRecycleBinUndo({ itemName: 'Draft', onUndo: vi.fn().mockResolvedValue(undefined) })

    await getUndoAction().onClick()

    expect(toast.success).toHaveBeenNthCalledWith(2, 'Restored from Archive')
  })

  it('keeps resource status readable with an archive title and a working undo action', async () => {
    const onUndo = vi.fn().mockResolvedValue(undefined)

    showRecycleBinUndo({
      itemName: 'Research agent',
      title: i18n.t('common.archived', { name: 'Research agent' }),
      description: i18n.t('agent.archive.related_resources'),
      onUndo
    })

    expect(getInitialToastConfig()).toMatchObject({
      title: 'Archived Research agent',
      description:
        "Linked channels will disconnect; scheduled tasks are paused. Settings, subscriptions, and run history are kept. Missed tasks won't run automatically after restoring the agent.",
      timeout: 10000,
      action: { label: 'Undo' }
    })

    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Restored from Archive')
  })

  it('logs and reports a rejected single-item restore without leaking the rejection', async () => {
    const error = new Error('stale')
    const loggerError = vi.spyOn(loggerService.withContext('recycleBinFeedback'), 'error').mockImplementation(() => {})

    showRecycleBinUndo({ itemName: 'Draft', onUndo: vi.fn().mockRejectedValue(error) })

    await expect(getUndoAction().onClick()).resolves.toBeUndefined()

    expect(loggerError).toHaveBeenCalledWith('Recycle Bin undo failed', error)
    expect(toast.error).toHaveBeenCalledWith('Failed to restore from Archive')
  })

  it('reports the restored and failed counts for a fully successful batch', async () => {
    const onUndo = vi.fn().mockResolvedValue({ restored: ['topic-a', 'topic-b'], failed: [] })

    showRecycleBinBatchUndo({ itemCount: 2, onUndo })

    expect(getInitialToastConfig()).toMatchObject({
      action: { label: 'Undo' },
      timeout: 5000,
      title: 'Moved to Archive: 2'
    })

    await getUndoAction().onClick()

    expect(onUndo).toHaveBeenCalledOnce()
    expect(toast.success).toHaveBeenNthCalledWith(2, 'Restore result — succeeded: 2, failed: 0')
    expect(toast.warning).not.toHaveBeenCalled()
  })

  it('uses a count-neutral moved label for a one-item batch', () => {
    showRecycleBinBatchUndo({ itemCount: 1, onUndo: vi.fn() })

    const title = getInitialToastConfig().title

    expect(title).toBe('Moved to Archive: 1')
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
    expect(toast.error).toHaveBeenCalledWith('Failed to restore from Archive')
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

  it('uses a custom not-found classifier before confirming concurrent restores through the active endpoint', async () => {
    const activeError = new Error('ipc session not found')
    const missingError = new Error('another ipc session not found')
    const restore = vi.fn().mockRejectedValueOnce(activeError).mockRejectedValueOnce(missingError)
    const getActive = vi
      .fn()
      .mockResolvedValueOnce({ id: 'session-active' })
      .mockRejectedValueOnce(new Error('still missing'))
    const isNotFound = vi.fn((error: unknown) => error === activeError || error === missingError)

    await expect(
      restoreRecycleBinItems({
        ids: ['session-active', 'session-missing'],
        restore,
        getActive,
        refresh: vi.fn().mockResolvedValue(undefined),
        isNotFound
      })
    ).resolves.toEqual({
      restored: ['session-active'],
      failed: [{ id: 'session-missing', error: missingError.message }]
    })

    expect(isNotFound).toHaveBeenCalledTimes(2)
    expect(getActive).toHaveBeenNthCalledWith(1, 'session-active')
    expect(getActive).toHaveBeenNthCalledWith(2, 'session-missing')
  })

  it('does not probe the active endpoint when a custom classifier rejects the restore error', async () => {
    const restoreError = new Error('ordinary ipc failure')
    const getActive = vi.fn()

    await expect(
      restoreRecycleBinItem({
        id: 'session-a',
        restore: vi.fn().mockRejectedValue(restoreError),
        getActive,
        refresh: vi.fn().mockResolvedValue(undefined),
        isNotFound: () => false
      })
    ).rejects.toThrow('ordinary ipc failure')

    expect(getActive).not.toHaveBeenCalled()
  })

  it('undoes only the primary item and related IDs returned by the delete operation', async () => {
    const calls: string[] = []
    const restorePrimary = vi.fn(async (id: string) => {
      calls.push(`primary:${id}`)
    })
    const restoreRelated = vi.fn(async (id: string) => {
      calls.push(`related:${id}`)
    })
    const refresh = vi.fn().mockResolvedValue(undefined)

    await restoreRecycleBinUndoGroup({
      primary: { id: 'assistant-1', restore: restorePrimary, getActive: vi.fn() },
      related: {
        ids: ['topic-1', 'topic-2'],
        restore: restoreRelated,
        getActive: vi.fn()
      },
      refresh
    })

    expect(calls).toEqual(['primary:assistant-1', 'related:topic-1', 'related:topic-2'])
    expect(restoreRelated).toHaveBeenCalledTimes(2)
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('applies separate custom not-found classifiers to a restore group primary and related items', async () => {
    const primaryError = new Error('primary not found')
    const relatedError = new Error('related not found')
    const primaryIsNotFound = vi.fn((error: unknown) => error === primaryError)
    const relatedIsNotFound = vi.fn((error: unknown) => error === relatedError)

    await expect(
      restoreRecycleBinUndoGroup({
        primary: {
          id: 'agent-1',
          restore: vi.fn().mockRejectedValue(primaryError),
          getActive: vi.fn().mockResolvedValue({ id: 'agent-1' }),
          isNotFound: primaryIsNotFound
        },
        related: {
          ids: ['session-1'],
          restore: vi.fn().mockRejectedValue(relatedError),
          getActive: vi.fn().mockResolvedValue({ id: 'session-1' }),
          isNotFound: relatedIsNotFound
        },
        refresh: vi.fn().mockResolvedValue(undefined)
      })
    ).resolves.toBeUndefined()

    expect(primaryIsNotFound).toHaveBeenCalledWith(primaryError)
    expect(relatedIsNotFound).toHaveBeenCalledWith(relatedError)
  })
})
