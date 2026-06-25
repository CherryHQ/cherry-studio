import { loggerService } from '@logger'

const logger = loggerService.withContext('utils:mcp')

/**
 * 从npm readme中提取 npx mcp config
 * @param {string} readme readme字符串
 * @returns {Record<string, any> | null} mcp config sample
 */
export function getMcpConfigSampleFromReadme(readme: string): Record<string, any> | null {
  if (readme) {
    try {
      const regex = /"mcpServers"\s*:\s*({(?:[^{}]*|{(?:[^{}]*|{[^{}]*})*})*})/g
      for (const match of readme.matchAll(regex)) {
        let orgSample = JSON.parse(match[1])
        orgSample = orgSample[Object.keys(orgSample)[0] ?? '']
        if (orgSample.command === 'npx') {
          return orgSample
        }
      }
    } catch (e) {
      logger.error('getMcpConfigSampleFromReadme', e as Error)
    }
  }
  return null
}
