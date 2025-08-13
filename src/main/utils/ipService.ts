import { loggerService } from '@logger'

const logger = loggerService.withContext('IpService')

/**
 * 获取用户的IP地址所在国家
 * @returns 返回国家代码，默认为'CN'
 */
export async function getIpCountry(): Promise<string> {
  try {
    // 添加超时控制
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const ipinfo = await fetch('https://ipinfo.io/json', {
      signal: controller.signal,
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    })

    clearTimeout(timeoutId)
    const data = await ipinfo.json()
    const country = data.country || 'CN'
    logger.info(`Detected user IP address country: ${country}`)
    return country
  } catch (error) {
    logger.error('Failed to get IP address information:', error as Error)
    return 'CN'
  }
}

/**
 * 检查用户是否在中国
 * @returns 如果用户在中国返回true，否则返回false
 */
export async function isUserInChina(): Promise<boolean> {
  const country = await getIpCountry()
  return country.toLowerCase() === 'cn'
}
