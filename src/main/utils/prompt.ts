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
import { RUNTIME_CONTEXT_PROMPT_PRESET } from '@shared/ai/prompts'

const logger = loggerService.withContext('utils:prompt')

export const VOLATILE_PROMPT_VARIABLES = ['{{time}}', '{{datetime}}'] as const
const CURRENT_DATE_PROMPT_VARIABLES = ['{{date}}', '{{datetime}}'] as const

const supportedVariables = [
  '{{username}}',
  '{{date}}',
  ...VOLATILE_PROMPT_VARIABLES,
  '{{system}}',
  '{{language}}',
  '{{arch}}',
  '{{model_name}}'
] as const

export const containsSupportedVariables = (userSystemPrompt: string): boolean =>
  supportedVariables.some((variable) => userSystemPrompt.includes(variable))

function formatCurrentDateIso(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** Request-time calendar date for Web Search query grounding. Not a module-load snapshot. */
export function buildCurrentDateContext(): string {
  const date = formatCurrentDateIso()
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
  return timeZone ? `Current date: ${date} (${timeZone})` : `Current date: ${date}`
}

function promptSuppliesCurrentDate(prompt: string | undefined): boolean {
  if (!prompt) return false
  return CURRENT_DATE_PROMPT_VARIABLES.some((variable) => prompt.includes(variable))
}

function runtimeContextSuppliesCurrentDate(enabled: boolean | undefined, template?: string): boolean {
  if (!enabled) return false
  const source = template?.trim() ? template : RUNTIME_CONTEXT_PROMPT_PRESET
  return promptSuppliesCurrentDate(source)
}

export function shouldInjectCurrentDateContext(input: {
  webSearchEnabled: boolean
  prompt?: string
  runtimeContextEnabled?: boolean
  runtimeContextPrompt?: string
}): boolean {
  if (!input.webSearchEnabled) return false
  if (promptSuppliesCurrentDate(input.prompt)) return false
  return !runtimeContextSuppliesCurrentDate(input.runtimeContextEnabled, input.runtimeContextPrompt)
}

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

export const buildRuntimeContextPrompt = (modelName?: string, template?: string): Promise<string> =>
  replacePromptVariables(template?.trim() ? template : RUNTIME_CONTEXT_PROMPT_PRESET, modelName)
