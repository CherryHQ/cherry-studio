/**
 * User-system-prompt variable substitution.
 *
 * Port of `replacePromptVariables` from `src/renderer/src/utils/prompt.ts`
 * (origin/main). Renderer-only data sources (Redux store, `window.api`) are
 * replaced with Main-process equivalents:
 *
 *   - `{{username}}` / `{{language}}` → `PreferenceService` (`app.user.name`,
 *      `app.language`)
 *   - `{{system}}`   → Node `os.platform()`
 *   - `{{arch}}`     → Node `os.arch()`
 *   - `{{model_name}}` → supplied by caller (no Redux default-model fallback)
 */

import os from 'node:os'

import { application } from '@application'
import { loggerService } from '@logger'

const logger = loggerService.withContext('utils:prompt')

const supportedVariables = [
  '{{username}}',
  '{{date}}',
  '{{time}}',
  '{{datetime}}',
  '{{system}}',
  '{{language}}',
  '{{arch}}',
  '{{model_name}}'
] as const

export const containsSupportedVariables = (userSystemPrompt: string): boolean =>
  supportedVariables.some((variable) => userSystemPrompt.includes(variable))

export const replacePromptVariables = async (userSystemPrompt: string, modelName?: string): Promise<string> => {
  if (typeof userSystemPrompt !== 'string') {
    logger.warn('User system prompt is not a string', { userSystemPrompt })
    return userSystemPrompt
  }

  const now = new Date()

  if (userSystemPrompt.includes('{{date}}')) {
    const date = now.toLocaleDateString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric'
    })
    userSystemPrompt = userSystemPrompt.replace(/{{date}}/g, date)
  }

  if (userSystemPrompt.includes('{{time}}')) {
    userSystemPrompt = userSystemPrompt.replace(/{{time}}/g, now.toLocaleTimeString())
  }

  if (userSystemPrompt.includes('{{datetime}}')) {
    const datetime = now.toLocaleString(undefined, {
      weekday: 'short',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      hour: 'numeric',
      minute: 'numeric',
      second: 'numeric'
    })
    userSystemPrompt = userSystemPrompt.replace(/{{datetime}}/g, datetime)
  }

  if (userSystemPrompt.includes('{{username}}')) {
    try {
      const userName = application.get('PreferenceService').get('app.user.name') || 'Unknown Username'
      userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, userName)
    } catch (error) {
      logger.error('Failed to resolve {{username}}', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{username}}/g, 'Unknown Username')
    }
  }

  if (userSystemPrompt.includes('{{system}}')) {
    try {
      userSystemPrompt = userSystemPrompt.replace(/{{system}}/g, os.platform())
    } catch (error) {
      logger.error('Failed to resolve {{system}}', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{system}}/g, 'Unknown System')
    }
  }

  if (userSystemPrompt.includes('{{language}}')) {
    try {
      const language = application.get('PreferenceService').get('app.language') ?? 'Unknown System Language'
      userSystemPrompt = userSystemPrompt.replace(/{{language}}/g, language)
    } catch (error) {
      logger.error('Failed to resolve {{language}}', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{language}}/g, 'Unknown System Language')
    }
  }

  if (userSystemPrompt.includes('{{arch}}')) {
    try {
      userSystemPrompt = userSystemPrompt.replace(/{{arch}}/g, os.arch())
    } catch (error) {
      logger.error('Failed to resolve {{arch}}', error as Error)
      userSystemPrompt = userSystemPrompt.replace(/{{arch}}/g, 'Unknown Architecture')
    }
  }

  if (userSystemPrompt.includes('{{model_name}}')) {
    userSystemPrompt = userSystemPrompt.replace(/{{model_name}}/g, modelName ?? 'Unknown Model')
  }

  return userSystemPrompt
}
