import { isGeminiModel } from '@renderer/config/models'
import { isSupportUrlContextProvider } from '@renderer/config/providers'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import UrlContextButton from '@renderer/pages/home/Inputbar/UrlContextbutton'
import { getProviderByModel } from '@renderer/services/AssistantService'

const urlContextTool = defineTool({
  key: 'url_context',
  label: (t) => t('chat.input.url_context'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ features, model }) => {
    if (!features.enableUrlContext) return false
    if (!isGeminiModel(model)) return false
    const provider = getProviderByModel(model)
    return !!provider && isSupportUrlContextProvider(provider)
  },
  render: ({ assistant }) => <UrlContextButton assistantId={assistant.id} />
})

registerTool(urlContextTool)

export default urlContextTool
