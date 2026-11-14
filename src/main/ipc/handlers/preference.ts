import { application } from '@application'
import type { preferenceRequestSchemas } from '@shared/ipc/schemas/preference'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Preference-domain IpcApi handlers. Whole-value reads/writes stay on the
 * dedicated `preference:*` channels (main/data/PreferenceService); routes here
 * are targeted writes whose read-modify-write must be atomic in main.
 */
export const preferenceHandlers: IpcHandlersFor<typeof preferenceRequestSchemas> = {
  'preference.set_reasoning_effort_mapping_entry': (update) =>
    application.get('PreferenceService').setReasoningEffortMappingEntry(update)
}
