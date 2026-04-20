/**
 * System-prompt plugin.
 *
 * Owns `params.system` for an AI request:
 *   1. Resolves template variables in `assistant.prompt` via
 *      `replacePromptVariables` (reads `{{username}}` / `{{language}}` from
 *       `PreferenceService`, `{{system}}`/`{{arch}}` from `node:os`,
 *      injects `{{model_name}}` from the resolved model, etc.).
 *   2. Appends the hub-mode system prompt when the assistant has
 *      `mcpMode === 'auto'` — lets the model know how to drive the hub's
 *      meta-tools (list / inspect / invoke / exec).
 *
 * Matches the renderer origin/main `parameterBuilder.buildStreamTextParams`
 * system-prompt assembly path.
 *
 * `AiService.buildAgentParams` leaves `agentSettings.instructions` undefined
 * so this plugin is the single source of truth for the request system
 * prompt; no risk of the agent's instructions and `params.system` drifting.
 *
 * Enforce = 'pre' — no dependency on later transforms; running early keeps
 * later middleware-level transforms (cache / tool-use prompt) seeing the
 * final system text.
 */

import { type AiPlugin, definePlugin, type StreamTextParams, type StreamTextResult } from '@cherrystudio/ai-core'
import { loggerService } from '@logger'
import { replacePromptVariables } from '@main/utils/prompt'
import type { Assistant } from '@shared/data/types/assistant'
import type { Model } from '@shared/data/types/model'

import { getHubModeSystemPrompt } from '../prompts/hubMode'
import { getEffectiveMcpMode } from '../tools/resolveAssistantMcpTools'

const logger = loggerService.withContext('systemPromptPlugin')

export interface SystemPromptPluginConfig {
  assistant: Assistant
  model: Model
}

export const createSystemPromptPlugin = ({
  assistant,
  model
}: SystemPromptPluginConfig): AiPlugin<StreamTextParams, StreamTextResult> =>
  definePlugin<StreamTextParams, StreamTextResult>({
    name: 'system-prompt',
    enforce: 'pre',
    transformParams: async (params) => {
      let systemPrompt = assistant.prompt ? await replacePromptVariables(assistant.prompt, model.name) : ''

      if (getEffectiveMcpMode(assistant) === 'auto') {
        const autoModePrompt = getHubModeSystemPrompt()
        if (autoModePrompt) {
          systemPrompt = systemPrompt ? `${systemPrompt}\n\n${autoModePrompt}` : autoModePrompt
        }
      }

      if (!systemPrompt) return {}

      logger.debug('resolved system prompt', { length: systemPrompt.length })
      return { ...params, system: systemPrompt }
    }
  })
