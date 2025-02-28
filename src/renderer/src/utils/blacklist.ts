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

      // 2. 处理域名通配符 (*.example.com)
      let domain = modifiedUrlString
      if (domain.includes('://')) {
        const parts = domain.split('://')
        const domainPart = parts[1]
        if (domainPart.startsWith('*.')) {
          domain = parts[0] + '://' + domainPart.substring(2)
        } else {
          domain = modifiedUrlString
        }
      } else if (domain.startsWith('*.')) {
        domain = domain.substring(2)
      } else {
        domain = modifiedUrlString
      }

      // 3. 检查并添加协议前缀
      if (!domain.match(/^[a-zA-Z]+:\/\//)) {
        domain = 'https://' + domain
      }

      // 4. URL 解析和验证
      const url = new URL(domain)
      if (url.protocol !== 'https:') {
        if (url.protocol !== 'http:') {
          hasError = true
        } else {
          url.protocol = 'https:'
        }
      }

      // 5. 格式化
      const formattedDomain = `https://${url.hostname}`
      formattedDomains.push(formattedDomain)
    } catch (error) {
      hasError = true
      console.error('Error formatting URL:', urlString, error)
    }
  }

  return { formattedDomains, hasError }
}

