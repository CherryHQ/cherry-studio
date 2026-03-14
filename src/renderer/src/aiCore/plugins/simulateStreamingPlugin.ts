import { definePlugin } from '@cherrystudio/ai-core'
import { simulateStreamingMiddleware } from 'ai'

/**
 * Simulate Streaming Plugin
 * Converts non-streaming responses to streaming format
 * Uses AI SDK's built-in simulateStreamingMiddleware
 */
export const createSimulateStreamingPlugin = () =>
  definePlugin({
    name: 'simulateStreaming',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(simulateStreamingMiddleware())
    }
  })
