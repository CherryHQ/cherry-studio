import { isAnthropicModel, isGeminiModel, isPureGenerateImageModel } from '@renderer/config/models'
import { defineTool, registerTool, TopicType } from '@renderer/pages/home/Inputbar/types'
import { getProviderById } from '@renderer/services/ProviderService'
import { isSupportUrlContextProvider } from '@renderer/utils/provider'

import UrlContextButton from './components/UrlContextbutton'

const urlContextTool = defineTool({
  key: 'url_context',
  label: (t) => t('chat.input.url_context'),
  visibleInScopes: [TopicType.Chat],
  condition: ({ model }) => {
    // v2 model.id encodes the provider; look the v1 store provider up by id.
    // (getProviderByModel's cherryai remap is unreachable here — those
    // remapped Qwen models fail the gemini/anthropic gate below.)
    const provider = getProviderById(model.providerId)
    return (
      !!provider &&
      isSupportUrlContextProvider(provider) &&
      !isPureGenerateImageModel(model) &&
      (isGeminiModel(model) || isAnthropicModel(model))
    )
  },
  render: ({ assistant }) => <UrlContextButton assistantId={assistant.id} />
})

registerTool(urlContextTool)

export default urlContextTool
