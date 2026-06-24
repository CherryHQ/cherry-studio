import { ThinkingToolRuntime } from '@renderer/components/chat/composer/tools/components/ThinkingButton'
import { defineTool, registerTool, TopicType } from '@renderer/components/chat/composer/tools/types'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('chat.input.thinking.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
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

registerTool(thinkingTool)

export default thinkingTool
