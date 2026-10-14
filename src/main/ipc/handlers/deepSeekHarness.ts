import { application } from '@application'
import type { deepSeekHarnessRequestSchemas } from '@shared/ipc/schemas/deepSeekHarness'
import type { IpcHandlersFor } from '@shared/ipc/types'

export const deepSeekHarnessHandlers: IpcHandlersFor<typeof deepSeekHarnessRequestSchemas> = {
  'deepseek_harness.start': async (input) => {
    try {
      return await application.get('DeepSeekHarnessService').start(input)
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  },
  'deepseek_harness.stop': async () => {
    try {
      await application.get('DeepSeekHarnessService').stop()
      return { success: true }
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : 'Unknown error' }
    }
  }
}
