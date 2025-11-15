import { isAnthropicModel, isGeminiModel } from '@renderer/config/models'
import { isSupportUrlContextProvider } from '@renderer/config/providers'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { getProviderByModel } from '@renderer/services/AssistantService'

import UrlContextButton from './components/UrlContextbutton'

const urlContextTool = defineTool({
  key: 'url_context',
  label: (t) => t('chat.input.url_context'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => {
    const provider = getProviderByModel(model)
    return !!provider && isSupportUrlContextProvider(provider) && (isGeminiModel(model) || isAnthropicModel(model))
  },
  render: ({ assistant }) => <UrlContextButton assistantId={assistant.id} />
})

registerTool(urlContextTool)

export default urlContextTool
