const QWEN_ENDPOINT_HOSTS: Record<string, string> = {
  'dashscope.aliyuncs.com': 'maas.qianwenaiapi.com',
  'dashscope-intl.aliyuncs.com': 'maas.qwencloudapi.com'
}

/** Replace only the literal official hostname, preserving the user's URL spelling and endpoint suffix. */
export function migrateQwenEndpointUrl(baseUrl: string): string {
  const hasInvalidCharacter = Array.from(baseUrl).some(
    (character) => character.charCodeAt(0) <= 32 || character === '\u007f' || character === '\\'
  )
  if (hasInvalidCharacter || !URL.canParse(baseUrl)) return baseUrl

  const url = new URL(baseUrl)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return baseUrl
  const hostname = QWEN_ENDPOINT_HOSTS[url.hostname]
  if (!hostname) return baseUrl

  return baseUrl.replace(
    /^(https?:\/\/(?:[^/?#]*@)?)(dashscope(?:-intl)?\.aliyuncs\.com)(?=[:/?#]|$)/i,
    (_match, prefix: string) => `${prefix}${hostname}`
  )
}
