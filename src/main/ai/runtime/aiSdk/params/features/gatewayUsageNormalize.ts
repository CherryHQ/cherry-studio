import type { LanguageModelV3StreamPart } from '@ai-sdk/provider'
import type { LanguageModelMiddleware } from 'ai'

import { definePlugin } from '@cherrystudio/ai-core'
import { isFlatV3Usage, normalizeFlatV3Usage } from '@main/ai/utils/usageNormalize'

import type { RequestFeature } from '../feature'

export {
  ensureNestedV3Usage,
  isFlatV3Usage as isFlatUsage,
  normalizeFlatV3Usage,
  normalizeFlatV3Usage as normalizeGatewayUsage
} from '@main/ai/utils/usageNormalize'

const gatewayUsageNormalizeMiddleware: LanguageModelMiddleware = {
  specificationVersion: 'v3',
  wrapGenerate: async ({ doGenerate }) => {
    const result = await doGenerate()
    return isFlatV3Usage(result.usage) ? { ...result, usage: normalizeFlatV3Usage(result.usage) } : result
  },
  wrapStream: async ({ doStream }) => {
    const { stream, ...rest } = await doStream()
    const normalized = stream.pipeThrough(
      new TransformStream<LanguageModelV3StreamPart, LanguageModelV3StreamPart>({
        transform(chunk, controller) {
          if (chunk.type === 'finish' && isFlatV3Usage(chunk.usage)) {
            controller.enqueue({ ...chunk, usage: normalizeFlatV3Usage(chunk.usage) })
            return
          }
          controller.enqueue(chunk)
        }
      })
    )
    return { stream: normalized, ...rest }
  }
}

function createGatewayUsageNormalizePlugin() {
  return definePlugin({
    name: 'gateway-usage-normalize',
    // Shape adapters belong directly against the provider. `post` makes this
    // middleware innermost, so usage capture and the application both observe
    // the normalized AI SDK v6 shape.
    enforce: 'post',
    configureContext: (context) => {
      context.middlewares = context.middlewares || []
      context.middlewares.push(gatewayUsageNormalizeMiddleware)
    }
  })
}

export const gatewayUsageNormalizeFeature: RequestFeature = {
  name: 'gateway-usage-normalize',
  // Flat usage can surface on any provider path; `isFlatV3Usage` is the gate.
  applies: () => true,
  contributeModelAdapters: () => [createGatewayUsageNormalizePlugin()]
}
