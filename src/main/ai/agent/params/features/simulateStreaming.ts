import { definePlugin } from '@cherrystudio/ai-core'
import { simulateStreamingMiddleware } from 'ai'

/**
 * Simulate Streaming Plugin
 * Converts non-streaming responses to streaming format
 * Uses AI SDK's built-in simulateStreamingMiddleware
 */
const createSimulateStreamingPlugin = () =>
  definePlugin({
    name: 'simulateStreaming',
    enforce: 'pre',

    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(simulateStreamingMiddleware())
    }
  })

import type { RequestFeature } from '../feature'

/** Wrap non-streaming `generate()` as a single-chunk stream. */
export const simulateStreamingFeature: RequestFeature = {
  name: 'simulate-streaming',
  applies: (scope) => scope.capabilities?.streamOutput === false,
  contributeModelAdapters: () => [createSimulateStreamingPlugin()]
}
