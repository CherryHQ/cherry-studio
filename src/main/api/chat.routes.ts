import Logger from 'electron-log'
import { Hono } from 'hono'
import type { ChatCompletion, ChatCompletionChunk } from 'openai/resources'
import { ChatCompletionCreateParams } from 'openai/resources'

export const setupChatRoutes = (app: Hono) => {
  app.post('/api/chat/completions', async (c) => {
    try {
      const request: ChatCompletionCreateParams = await c.req.json()

      Logger.info('Chat completion request:', {
        model: request.model,
        messageCount: request.messages.length,
        stream: request.stream
      })

      // Validate request
      if (!request.model) {
        return c.json({ error: 'Model is required' }, 400)
      }

      if (!request.messages || !Array.isArray(request.messages) || request.messages.length === 0) {
        return c.json({ error: 'Messages array is required and cannot be empty' }, 400)
      }

      // TODO: This is a placeholder implementation
      // In the next step, we'll integrate with Cherry Studio's AI core
      const response: ChatCompletion = {
        id: `chatcmpl-${Date.now()}`,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: request.model,
        choices: [
          {
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant',
              content: 'This is a placeholder response. Chat completions will be implemented in the next phase.',
              refusal: null
            },
            finish_reason: 'stop'
          }
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 15,
          total_tokens: 25
        }
      }

      if (request.stream) {
        // For streaming, we'll implement this properly in the next phase
        c.header('Content-Type', 'text/event-stream')
        c.header('Cache-Control', 'no-cache')
        c.header('Connection', 'keep-alive')

        const encoder = new TextEncoder()
        const stream = new ReadableStream({
          start(controller) {
            const chunk: ChatCompletionChunk = {
              id: response.id,
              object: 'chat.completion.chunk',
              created: response.created,
              model: response.model,
              choices: [
                {
                  index: 0,
                  delta: { content: response.choices[0].message.content },
                  finish_reason: null
                }
              ]
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(chunk)}\n\n`))

            const endChunk: ChatCompletionChunk = {
              ...chunk,
              choices: [
                {
                  index: 0,
                  delta: {},
                  finish_reason: 'stop'
                }
              ]
            }

            controller.enqueue(encoder.encode(`data: ${JSON.stringify(endChunk)}\n\n`))
            controller.enqueue(encoder.encode('data: [DONE]\n\n'))
            controller.close()
          }
        })

        return new Response(stream, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            Connection: 'keep-alive'
          }
        })
      }

      return c.json(response)
    } catch (error) {
      Logger.error('Error in chat completions endpoint:', error)
      return c.json(
        {
          error: 'Failed to process chat completion request',
          message: error instanceof Error ? error.message : 'Unknown error'
        },
        500
      )
    }
  })
}
