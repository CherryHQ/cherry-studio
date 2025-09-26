import { isSupportedReasoningEffortModel, isSupportedThinkingTokenModel } from '@renderer/config/models'
import ThinkingButton from '@renderer/pages/home/Inputbar/ThinkingButton'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

const thinkingTool = defineTool({
  key: 'thinking',
  label: (t) => t('chat.input.thinking.label'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features, model }) =>
    features.enableThinking && (isSupportedThinkingTokenModel(model) || isSupportedReasoningEffortModel(model)),
  render: ({ assistant, model, quickPanel }) => (
    <ThinkingButton quickPanel={quickPanel} model={model} assistantId={assistant.id} />
  )
})

registerTool(thinkingTool)

export default thinkingTool
