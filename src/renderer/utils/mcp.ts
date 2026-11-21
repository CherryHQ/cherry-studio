import type { JSONObject, JSONValue } from '@ai-sdk/provider'

import { loggerService } from '@logger'
import { McpConfigSampleSchema } from '@shared/data/types/mcpServer'

const logger = loggerService.withContext('utils:mcp')
const npxConfigSampleSchema = McpConfigSampleSchema.extend({ args: McpConfigSampleSchema.shape.args.nullish() })
type NpxConfigSample = JSONObject & ReturnType<typeof npxConfigSampleSchema.parse>

/**
 * 从npm readme中提取 npx mcp config
 * @param {string} readme readme字符串
 * @returns The first compatible npx JSON sample, retaining extension fields, or null.
 */
export function getMcpConfigSampleFromReadme(readme: string): NpxConfigSample | null {
  if (!readme) return null

  // Single-char `[^{}]` inside the repeated groups: `[^{}]*` there backtracks exponentially on unmatched blocks.
  const regex = /"mcpServers"\s*:\s*({(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*})/g
  for (const match of readme.matchAll(regex)) {
    // One malformed or empty block must not hide the valid samples after it.
    try {
      const parsed: JSONValue = JSON.parse(match[1])
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      for (const server of Object.values(parsed)) {
        if (server && typeof server === 'object') {
          const sample = npxConfigSampleSchema.safeParse(server)
          if (sample.success && sample.data.command === 'npx') {
            const env = (server as JSONObject).env
            // Zod records skip __proto__; validate its raw value before retaining the original object.
            if (
              env &&
              typeof env === 'object' &&
              Object.hasOwn(env, '__proto__') &&
              !McpConfigSampleSchema.shape.env.unwrap().valueType.safeParse((env as JSONObject)['__proto__']).success
            ) {
              continue
            }
            return server as NpxConfigSample
          }
        }
      }
    } catch (e) {
      logger.error('getMcpConfigSampleFromReadme', e as Error)
    }
  }
  return null
}
