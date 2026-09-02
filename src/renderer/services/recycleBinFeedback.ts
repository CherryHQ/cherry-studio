import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { toast } from '@renderer/services/toast'

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
