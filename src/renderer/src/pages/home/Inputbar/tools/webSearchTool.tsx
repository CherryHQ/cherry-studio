import { isMandatoryWebSearchModel } from '@renderer/config/models'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'

import WebSearchButton from './components/WebSearchButton'

/**
 * Web Search Tool
 *
 * Toggle that flips `assistant.settings.enableWebSearch`. Provider selection
 * happens server-side at tool execute time — see `WebSearchTool.ts`'s
 * `pickFirstUsableProvider`. The previous quick-panel picker has been
 * retired now that there's no per-assistant provider id to set.
 */
const webSearchTool = defineTool({
  key: 'web_search',
  label: (t) => t('chat.input.web_search.label'),

  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => !isMandatoryWebSearchModel(model),

  render: function WebSearchToolRender(context) {
    return <WebSearchButton assistantId={context.assistant.id} />
  }
})

registerTool(webSearchTool)

export default webSearchTool
