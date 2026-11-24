import os from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'
import { getAppLanguage } from '@main/i18n'
import { getDeviceType } from '@main/utils/system'
import { replacePromptVariables as replaceSharedPromptVariables } from '@shared/ai/promptVariables'

const logger = loggerService.withContext('utils:prompt')

export const replacePromptVariables = (userSystemPrompt: string, modelName?: string): Promise<string> =>
  replaceSharedPromptVariables(userSystemPrompt, modelName, {
    username: () => application.get('PreferenceService').get('app.user.name'),
    system: getDeviceType,
    language: getAppLanguage,
    arch: () => os.arch(),
    onError: (variable, error) => logger.error(`Failed to resolve ${variable}`, error as Error)
  })
