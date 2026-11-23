import { loggerService } from '@logger'
import i18n from '@renderer/i18n/resolver'
import { openSettingsTab } from '@renderer/services/mainWindowNavigation'
import { toast } from '@renderer/services/toast'
import { getErrorMessage } from '@renderer/utils/error'
import { isDataApiNotFoundError } from '@shared/data/api/errors'

const logger = loggerService.withContext('recycleBinFeedback')

/** Every archived item lands in the same Archive page, so the way back to it is identical for all of them. */
function viewArchiveAction() {
  return {
    label: i18n.t('recycle_bin.view_archive'),
    onClick: () => openSettingsTab('/settings/archive')
  }
}

export function showRecycleBinUndo(input: {
  itemName: string
  title?: string
  description?: string
  onUndo: () => Promise<void>
}): void {
  toast.success({
    title: input.title ?? i18n.t('recycle_bin.moved', { name: input.itemName }),
    description: input.description,
    timeout: input.description ? 10000 : 5000,
    secondaryAction: viewArchiveAction(),
    action: {
      label: i18n.t('common.undo'),
      onClick: async () => {
        try {
          await input.onUndo()
          toast.success(i18n.t('recycle_bin.restored'))
        } catch (error) {
          logger.error('Recycle Bin undo failed', error)
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

interface RestoreRecycleBinItemTarget<TRestore, TActive> {
  id: string
  restore: (id: string) => Promise<TRestore>
  getActive: (id: string) => Promise<TActive>
  // oxlint-disable-next-line anti-slop/no-unknown-parameters -- Restore and active-item reads expose arbitrary rejections; the injected recognizer owns not-found reconciliation.
  isNotFound?: (error: unknown) => boolean
}

interface RestoreRecycleBinItemsInput<TRestore, TActive, TRefresh> extends Omit<
  RestoreRecycleBinItemTarget<TRestore, TActive>,
  'id'
> {
  ids: readonly string[]
  refresh: () => Promise<TRefresh>
}

interface RestoreRecycleBinUndoGroupInput<TPrimaryRestore, TPrimaryActive, TRelatedRestore, TRelatedActive, TRefresh> {
  primary: RestoreRecycleBinItemTarget<TPrimaryRestore, TPrimaryActive>
  related: Omit<RestoreRecycleBinItemsInput<TRelatedRestore, TRelatedActive, void>, 'refresh'>
  refresh: () => Promise<TRefresh>
}

async function restoreOrConfirmActive<TRestore, TActive>(
  id: string,
  restore: RestoreRecycleBinItemTarget<TRestore, TActive>['restore'],
  getActive: RestoreRecycleBinItemTarget<TRestore, TActive>['getActive'],
  isNotFound: NonNullable<RestoreRecycleBinItemTarget<TRestore, TActive>['isNotFound']> = isDataApiNotFoundError
): Promise<void> {
  try {
    await restore(id)
  } catch (error) {
    if (!isNotFound(error)) throw error

    try {
      await getActive(id)
    } catch {
      throw error
    }
  }
}

async function restoreItems<TRestore, TActive>(
  input: Omit<RestoreRecycleBinItemsInput<TRestore, TActive, void>, 'refresh'>
): Promise<BatchUndoResult> {
  const outcomes = await Promise.allSettled(
    input.ids.map((id) => restoreOrConfirmActive(id, input.restore, input.getActive, input.isNotFound))
  )

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

async function refreshAfterRestore<TRefresh>(refresh: () => Promise<TRefresh>): Promise<void> {
  try {
    await refresh()
  } catch (error) {
    logger.warn('Failed to refresh after Recycle Bin restore', error)
  }
}

export async function restoreRecycleBinItems<TRestore, TActive, TRefresh>(
  input: RestoreRecycleBinItemsInput<TRestore, TActive, TRefresh>
): Promise<BatchUndoResult> {
  const result = await restoreItems(input)
  await refreshAfterRestore(input.refresh)

  return result
}

export async function restoreRecycleBinItem<TRestore, TActive, TRefresh>(
  input: Omit<RestoreRecycleBinItemsInput<TRestore, TActive, TRefresh>, 'ids'> & { id: string }
) {
  const result = await restoreRecycleBinItems({ ...input, ids: [input.id] })
  const failure = result.failed[0]

  if (failure) throw new Error(failure.error)
}

/** Undo one UI delete operation without making unrelated entities part of the primary entity's restore contract. */
export async function restoreRecycleBinUndoGroup<
  TPrimaryRestore,
  TPrimaryActive,
  TRelatedRestore,
  TRelatedActive,
  TRefresh
>(
  input: RestoreRecycleBinUndoGroupInput<TPrimaryRestore, TPrimaryActive, TRelatedRestore, TRelatedActive, TRefresh>
): Promise<void> {
  let relatedResult: BatchUndoResult = { restored: [], failed: [] }

  try {
    await restoreOrConfirmActive(
      input.primary.id,
      input.primary.restore,
      input.primary.getActive,
      input.primary.isNotFound
    )
    relatedResult = await restoreItems(input.related)
  } finally {
    await refreshAfterRestore(input.refresh)
  }

  const failure = relatedResult.failed[0]

  if (failure) throw new Error(failure.error)
}

export function showRecycleBinBatchUndo(input: { itemCount: number; onUndo: () => Promise<BatchUndoResult> }): void {
  toast.success({
    title: i18n.t('recycle_bin.moved_count', { count: input.itemCount }),
    timeout: 5000,
    secondaryAction: viewArchiveAction(),
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
          logger.error('Recycle Bin batch undo failed', error)
          toast.error(i18n.t('recycle_bin.restore_failed'))
        }
      }
    }
  })
}
