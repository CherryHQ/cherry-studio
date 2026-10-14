import { application } from '@application'
import type { quickAssistantRequestSchemas } from '@shared/ipc/schemas/quickAssistant'
import type { IpcHandlersFor } from '@shared/ipc/types'

/**
 * Quick Assistant handlers — thin delegates to the QuickAssistantService lifecycle
 * service. The platform-compensation logic (anti-flicker hide, hide-not-destroy close,
 * NSPanel focus-poll pin state machine) stays in those service methods, unchanged.
 */
export const quickAssistantHandlers: IpcHandlersFor<typeof quickAssistantRequestSchemas> = {
  'quick_assistant.hide': async () => {
    application.get('QuickAssistantService').hideQuickAssistant()
  },
  'quick_assistant.close': async () => {
    application.get('QuickAssistantService').closeQuickAssistant()
  },
  'quick_assistant.set_pin': async ({ isPinned }) => {
    application.get('QuickAssistantService').setPinQuickAssistant(isPinned)
  }
}
