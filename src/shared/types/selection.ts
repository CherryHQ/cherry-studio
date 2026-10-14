import type { SelectionActionItem } from '@shared/data/preference/preferenceTypes'

export interface SelectionActionSession extends SelectionActionItem {
  sessionId: string
}
