import { loggerService } from '@logger'
import { net } from 'electron'

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

    const ipinfo = await net.fetch(`https://api.ipinfo.io/lite/me?token=2a42580355dae4`, {
      signal: controller.signal
    })

    clearTimeout(timeoutId)
    const data = await ipinfo.json()
    const country = data.country_code || 'CN'
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
