import Logger from 'electron-log'
import { Hono } from 'hono'

// OpenAI compatible model response
interface ModelResponse {
  object: 'list'
  data: ModelData[]
}

interface ModelData {
  id: string
  object: 'model'
  created: number
  owned_by: string
}

export const setupModelsRoutes = (app: Hono) => {
  app.get('/api/models', async (c) => {
    try {
      Logger.info('Models list request')

      // TODO: This is a placeholder implementation
      // In the next step, we'll integrate with Cherry Studio's provider system
      const models: ModelData[] = [
        {
          id: 'openai:gpt-4',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'openai'
        },
        {
          id: 'anthropic:claude-3-sonnet',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'anthropic'
        },
        {
          id: 'openai:gpt-3.5-turbo',
          object: 'model',
          created: Math.floor(Date.now() / 1000),
          owned_by: 'openai'
        }
      ]

      const response: ModelResponse = {
        object: 'list',
        data: models
      }

      return c.json(response)
    } catch (error) {
      Logger.error('Error in models endpoint:', error)
      return c.json(
        {
          error: 'Failed to list models',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        500
      )
    }
  })
}
