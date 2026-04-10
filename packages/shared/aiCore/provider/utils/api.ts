import { formatApiHost, withoutTrailingSlash } from '@shared/utils'

/**
 * 格式化 Ollama 的 API 主机地址。
 */
export function formatOllamaApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    ?.replace(/\/api$/, '')
    ?.replace(/\/chat$/, '')
  return formatApiHost(normalizedHost + '/api', false)
}

/**
 * Format Azure OpenAI API host address.
 */
export function formatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)
    ?.replace(/\/v1$/, '')
    .replace(/\/openai$/, '')
  // NOTE: AISDK会添加上`v1`
  return formatApiHost(normalizedHost + '/openai', false)
}
