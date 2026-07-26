import { ThinkingToolRuntime } from '@renderer/components/composer/tools/components/ThinkingButton'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('chat.input.thinking.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  composer: {
    runtime: ({ context: { assistant, model, launcher, reasoning } }) => (
      <ThinkingToolRuntime
        launcher={launcher}
        model={model}
        assistant={assistant}
        reasoningEffort={reasoning?.effort}
        onReasoningEffortChange={reasoning?.onEffortChange}
      />
    )
  }
})

export default thinkingTool
