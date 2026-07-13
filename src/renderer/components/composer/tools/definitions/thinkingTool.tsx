import { ThinkingToolRuntime } from '@renderer/components/composer/tools/components/ThinkingButton'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'
import { isClaudeCodeProviderId } from '@shared/data/presets/claudeCode'
import { isCodexProviderId } from '@shared/data/presets/codex'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('chat.input.thinking.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  condition: ({ scope, model }) =>
    scope !== TopicType.Session ||
    (!isClaudeCodeProviderId(model.providerId) && !isCodexProviderId(model.providerId)),
  composer: {
    runtime: ({ context: { assistant, model, launcher, session } }) => (
      <ThinkingToolRuntime
        launcher={launcher}
        model={model}
        assistantId={assistant?.id}
        reasoningEffort={session?.reasoningEffort}
        onReasoningEffortChange={session?.onReasoningEffortChange}
      />
    )
  }
})

export default thinkingTool
