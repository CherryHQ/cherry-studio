import { Model } from '@renderer/types'
import { ChatCompletionTool } from 'openai/resources'

export function getWebSearchTools(model: Model): ChatCompletionTool[] {
  if (model?.provider === 'zhipu') {
    if (model.id === 'glm-4-alltools') {
      return [
        {
          type: 'web_browser'
        } as unknown as ChatCompletionTool
      ]
    }
    return [
      {
        type: 'web_search',
        web_search: {
          enable: true,
          search_result: true
        }
      } as unknown as ChatCompletionTool
    ]
  }

  return [
    {
      type: 'function',
      function: {
        name: 'googleSearch'
      }
    }
  ]
}
