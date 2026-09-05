import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'
import { getErrorMessage } from '@renderer/utils/error'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

const logger = loggerService.withContext('recycleBinFeedback')

export function showRecycleBinUndo(input: { itemName: string; onUndo: () => Promise<void> }): void {
  toast.success({
    title: i18n.t('recycle_bin.moved', { name: input.itemName }),
    timeout: 5000,
    action: {
      label: i18n.t('common.undo'),
      onClick: async () => {
        try {
          await input.onUndo()
          toast.success(i18n.t('recycle_bin.restored'))
        } catch (error) {
          logger.error('Recycle Bin undo failed', error as Error)
          toast.error(i18n.t('recycle_bin.restore_failed'))
        }
      }
    }
  })
}

export interface BatchUndoResult {
  restored: string[]
  failed: Array<{ id: string; error: string }>
}

interface RestoreRecycleBinItemsInput {
  ids: readonly string[]
  restore: (id: string) => Promise<unknown>
  getActive: (id: string) => Promise<unknown>
  refresh: () => Promise<unknown>
}

async function restoreOrConfirmActive(
  id: string,
  restore: RestoreRecycleBinItemsInput['restore'],
  getActive: RestoreRecycleBinItemsInput['getActive']
): Promise<void> {
  try {
    await restore(id)
  } catch (error) {
    if (!isDataApiNotFoundError(error)) throw error
    try {
      await getActive(id)
    } catch {
      throw error
    }
  }
}

export async function restoreRecycleBinItems(input: RestoreRecycleBinItemsInput): Promise<BatchUndoResult> {
  const outcomes = await Promise.allSettled(
    input.ids.map((id) => restoreOrConfirmActive(id, input.restore, input.getActive))
  )
  try {
    await input.refresh()
  } catch (error) {
    logger.warn('Failed to refresh after Recycle Bin restore', error as Error)
  }

  return outcomes.reduce<BatchUndoResult>(
    (result, outcome, index) => {
      const id = input.ids[index]
      if (outcome.status === 'fulfilled') result.restored.push(id)
      else result.failed.push({ id, error: getErrorMessage(outcome.reason) })
      return result
    },
    { restored: [], failed: [] }
  )
}

export async function restoreRecycleBinItem(input: Omit<RestoreRecycleBinItemsInput, 'ids'> & { id: string }) {
  const result = await restoreRecycleBinItems({ ...input, ids: [input.id] })
  const failure = result.failed[0]
  if (failure) throw new Error(failure.error)
}

export function showRecycleBinBatchUndo(input: { itemCount: number; onUndo: () => Promise<BatchUndoResult> }): void {
  toast.success({
    title: i18n.t('recycle_bin.moved_count', { count: input.itemCount }),
    timeout: 5000,
    action: {
      label: i18n.t('common.undo'),
      onClick: async () => {
        try {
          const result = await input.onUndo()
          toast[result.failed.length === 0 ? 'success' : 'warning'](
            i18n.t('recycle_bin.restore_batch_result', {
              restored: result.restored.length,
              failed: result.failed.length
            })
          )
        } catch (error) {
          logger.error('Recycle Bin batch undo failed', error as Error)
          toast.error(i18n.t('recycle_bin.restore_failed'))
        }
      }
    }
  })
}
