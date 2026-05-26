import { createPromptToolUsePlugin } from '@cherrystudio/ai-core/built-in/plugins'

import type { RequestFeature } from '../feature'

/**
 * Prompt-mode tool use (XML <tool_use> blocks) for models that don't support
 * native function calling or when the user opts into prompt mode.
 */
export const promptToolUseFeature: RequestFeature = {
  name: 'prompt-tool-use',
  applies: (scope) => Boolean(scope.capabilities?.isPromptToolUse),
  contributeModelAdapters: (scope) => [
    createPromptToolUsePlugin({ enabled: true, mcpMode: scope.assistant?.settings?.mcpMode ?? 'auto' })
  ]
}
