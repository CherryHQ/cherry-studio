import { isMandatoryWebSearchModel } from '@renderer/config/models'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import WebSearchButton from '@renderer/pages/home/Inputbar/WebSearchButton'

const webSearchTool = defineTool({
  key: 'web_search',
  label: (t) => t('chat.input.web_search.label'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features, model }) => features.enableWebSearch && !isMandatoryWebSearchModel(model),
  render: ({ assistant, quickPanel }) => <WebSearchButton quickPanel={quickPanel} assistantId={assistant.id} />
})

registerTool(webSearchTool)

export default webSearchTool
