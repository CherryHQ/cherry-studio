import { application } from '@application'
import type { englishLearningRequestSchemas } from '@shared/ipc/schemas/englishLearning'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const englishLearningHandlers: IpcHandlersFor<typeof englishLearningRequestSchemas> = {
  'english_learning.reminder.snooze': ({ minutes }) =>
    application.get('EnglishLearningReminderService').snooze(minutes),
  'english_learning.reminder.open_today': async () => application.get('EnglishLearningReminderService').openToday()
}
