import { Model } from '@renderer/types'
import { ChatCompletionTool } from 'openai/resources'

import { WEB_SEARCH_PROMPT_FOR_ZHIPU } from './prompts'

export function getWebSearchTools(model: Model): ChatCompletionTool[] {
  if (model?.provider === 'zhipu') {
    if (model.id === 'glm-4-alltools') {
      return [
        {
          type: 'web_browser',
          web_browser: {
            browser: 'auto'
          }
        } as unknown as ChatCompletionTool
      ]
    }
    return [
      {
        type: 'web_search',
        web_search: {
          enable: true,
          search_result: true,
          search_prompt: WEB_SEARCH_PROMPT_FOR_ZHIPU
        }
      } as unknown as ChatCompletionTool
    ]
  }

  if (model?.id.includes('gemini')) {
    return [
      {
        type: 'function',
        function: {
          name: 'googleSearch'
        }
      }
    ]
  }
  return []
}

export function getUrlContextTools(model: Model): ChatCompletionTool[] {
  if (model.id.includes('gemini')) {
    return [
      {
        type: 'function',
        function: {
          name: 'urlContext'
        }
      }
    ]
  }

  return []
}
