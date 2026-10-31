import { loggerService } from '@logger'

const logger = loggerService.withContext('utils:mcp')

/**
 * 从npm readme中提取 npx mcp config
 * @param {string} readme readme字符串
 * @returns {Record<string, any> | null} mcp config sample
 */
export function getMcpConfigSampleFromReadme(readme: string): Record<string, any> | null {
  if (!readme) return null

  // Single-char `[^{}]` inside the repeated groups: `[^{}]*` there backtracks exponentially on unmatched blocks.
  const regex = /"mcpServers"\s*:\s*({(?:[^{}]|{(?:[^{}]|{[^{}]*})*})*})/g
  for (const match of readme.matchAll(regex)) {
    // One malformed or empty block must not hide the valid samples after it.
    try {
      const parsed = JSON.parse(match[1])
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) continue
      const [first] = Object.values(parsed)
      if (first && typeof first === 'object' && (first as Record<string, any>).command === 'npx') {
        return first as Record<string, any>
      }
    } catch (e) {
      logger.error('getMcpConfigSampleFromReadme', e as Error)
    }
  }
  return null
}
