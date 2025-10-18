import store from '@renderer/store'
import { VertexProvider } from '@renderer/types'
import { trim } from 'lodash'

/**
 * 格式化 API key 字符串。
 *
 * @param {string} value - 需要格式化的 API key 字符串。
 * @returns {string} 格式化后的 API key 字符串。
 */
export function formatApiKeys(value: string): string {
  return value.replaceAll('，', ',').replaceAll('\n', ',')
}

/**
 * 判断 host 的 path 中是否包含形如版本的字符串（例如 /v1、/v2beta 等），
 *
 * @param host - 要检查的 host 或 path 字符串
 * @returns 如果 path 中包含版本字符串则返回 true，否则 false
 */
export function hasAPIVersion(host?: string): boolean {
  if (!host) return false

  const versionRegex = /\/v\d+([a-z0-9._-]*)/i

  try {
    const url = new URL(host)
    return versionRegex.test(url.pathname)
  } catch {
    // 若无法作为完整 URL 解析，则当作路径直接检测
    return versionRegex.test(host)
  }
}

export function withoutTrailingSlash(url: string | undefined) {
  return url?.replace(/\/$/, '')
}

/**
 * 格式化 API 主机地址。
 *
 * 根据传入的 host 判断是否需要在其末尾加 `apiVersion`。
 * - 不加：host 以 `vxxx`结尾
 * - 要加：其余情况。
 *
 * @param {string} host - 需要格式化的 API 主机地址。
 * @param {string} apiVersion - 需要添加的 API 版本。
 * @returns {string} 格式化后的 API 主机地址。
 */
export function formatApiHost(host?: string, isSupportedAPIVerion: boolean = true, apiVersion: string = 'v1'): string {
  const normalizedHost = withoutTrailingSlash(trim(host))
  if (!normalizedHost) {
    return ''
  }

  if (!isSupportedAPIVerion || hasAPIVersion(normalizedHost)) {
    return normalizedHost
  }
  return `${normalizedHost}/${apiVersion}`
}

/**
 * 格式化 Azure OpenAI 的 API 主机地址。
 */
export function formatAzureOpenAIApiHost(host: string): string {
  const normalizedHost = withoutTrailingSlash(host)?.replace(/\/openai$/, '')
  // AISDK会添加上`v1`
  return formatApiHost(normalizedHost + '/openai', false)
}

export function formatVertexApiHost(provider: VertexProvider): string {
  const { apiHost } = provider
  const { projectId: project, location } = store.getState().llm.settings.vertexai
  const trimmedHost = withoutTrailingSlash(trim(apiHost))
  if (!trimmedHost || trimmedHost.endsWith('aiplatform.googleapis.com')) {
    const host =
      location == 'global' ? 'https://aiplatform.googleapis.com' : `https://${location}-aiplatform.googleapis.com`
    return `${formatApiHost(host)}/projects/${project}/locations/${location}`
  }
  return formatApiHost(trimmedHost)
}

/**
 * API key 脱敏函数。仅保留部分前后字符，中间用星号代替。
 *
 * - 长度大于 24，保留前、后 8 位。
 * - 长度大于 16，保留前、后 4 位。
 * - 长度大于 8，保留前、后 2 位。
 * - 其余情况，返回原始密钥。
 *
 * @param {string} key - 需要脱敏的 API 密钥。
 * @returns {string} 脱敏后的密钥字符串。
 */
export function maskApiKey(key: string): string {
  if (!key) return ''

  if (key.length > 24) {
    return `${key.slice(0, 8)}****${key.slice(-8)}`
  } else if (key.length > 16) {
    return `${key.slice(0, 4)}****${key.slice(-4)}`
  } else if (key.length > 8) {
    return `${key.slice(0, 2)}****${key.slice(-2)}`
  } else {
    return key
  }
}

/**
 * 将 API key 字符串转换为 key 数组。
 *
 * @param {string} keyStr - 包含 API key 的逗号分隔字符串。
 * @returns {string[]} 转换后的数组，每个元素为 API key。
 */
export function splitApiKeyString(keyStr: string): string[] {
  return keyStr
    .split(/(?<!\\),/)
    .map((k) => k.trim())
    .map((k) => k.replace(/\\,/g, ','))
    .filter((k) => k)
}
