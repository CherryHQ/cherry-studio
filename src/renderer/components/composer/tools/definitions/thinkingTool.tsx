import {
  THINKING_TOOLBAR_MANIFEST,
  ThinkingToolRuntime
} from '@renderer/components/composer/tools/components/ThinkingButton'
import { defineTool, TopicType } from '@renderer/components/composer/tools/types'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('assistants.settings.reasoning_effort.label'),
  visibleInScopes: [TopicType.Chat, TopicType.Session],
  composer: {
    toolbar: THINKING_TOOLBAR_MANIFEST,
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
