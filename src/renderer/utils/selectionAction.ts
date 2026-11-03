import { loggerService } from '@logger'
import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'
import { type SelectionAction, SelectionActionSchema } from '@shared/types/selection'

const logger = loggerService.withContext('selectionAction')

/** Narrows stored action items; an item that does not parse is skipped so the rest stay usable. */
export function parseSelectionActions(items: readonly SelectionActionItem[]): SelectionAction[] {
  return items.flatMap((item) => {
    const result = SelectionActionSchema.safeParse(item)
    if (result.success) return [result.data]
    logger.warn('Skipping an invalid selection action', { id: item.id, issues: result.error.issues })
    return []
  })
}
