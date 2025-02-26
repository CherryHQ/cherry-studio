interface FormatDomainsResult {
  formattedDomains: string[]
  hasError: boolean
}

export function formatDomains(urls: string[]): FormatDomainsResult {
  let hasError = false
  const formattedDomains: string[] = []

  for (const urlString of urls) {
    try {
      let modifiedUrlString = urlString

      // 1. 处理通配符协议 (*://)
      if (modifiedUrlString.startsWith('*://')) {
        modifiedUrlString = modifiedUrlString.substring(4)
      }

      // 2. 检查并添加协议前缀
      if (!modifiedUrlString.match(/^[a-zA-Z]+:\/\//)) {
        modifiedUrlString = 'https://' + modifiedUrlString
      }

      // 3. URL 解析和验证
      const url = new URL(modifiedUrlString)
      if (url.protocol !== 'https:') {
        if (url.protocol !== 'http:') {
          hasError = true
        } else {
          url.protocol = 'https:'
        }
      }

      // 4. 通配符处理
      let domain = url.hostname
      if (domain.startsWith('*.')) {
        domain = domain.substring(2)
      }

      // 5. 格式化
      const formattedDomain = `https://${domain}`
      formattedDomains.push(formattedDomain)
    } catch (error) {
      hasError = true
      console.error('Error formatting URL:', urlString, error)
    }
  }

  return { formattedDomains, hasError }
}
