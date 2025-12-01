import { isMandatoryWebSearchModel } from '@renderer/config/models'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

import WebSearchButton from './components/WebSearchButton'
import WebSearchQuickPanelManager from './components/WebSearchQuickPanelManager'

/**
 * Web Search Tool
 *
 * Allows users to enable web search for their messages.
 * Supports both model built-in search and external search providers.
 */
const webSearchTool = defineTool({
  key: 'web_search',
  label: (t) => t('chat.input.web_search.label'),

  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => !isMandatoryWebSearchModel(model),

  render: function WebSearchToolRender(context) {
    const { assistant, quickPanelController } = context

    return <WebSearchButton quickPanelController={quickPanelController} assistantId={assistant.id} />
  },
  quickPanelManager: WebSearchQuickPanelManager
})

registerTool(webSearchTool)

export default webSearchTool
