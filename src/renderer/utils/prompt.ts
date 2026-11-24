import { loggerService } from '@logger'
import { preferenceService } from '@renderer/data/PreferenceService'
import { getLanguage } from '@renderer/i18n/resolver'
import { ipcApi } from '@renderer/ipc'
import { replacePromptVariables as replaceSharedPromptVariables } from '@shared/ai/promptVariables'

const logger = loggerService.withContext('Utils:Prompt')

export const replacePromptVariables = (userSystemPrompt: string, modelName?: string): Promise<string> =>
  replaceSharedPromptVariables(userSystemPrompt, modelName, {
    username: () => preferenceService.get('app.user.name'),
    system: () => ipcApi.request('system.get_device_type'),
    language: getLanguage,
    arch: async () => (await ipcApi.request('app.get_info')).arch,
    onError: (variable, error) => logger.error(`Failed to resolve ${variable}`, error as Error)
  })
