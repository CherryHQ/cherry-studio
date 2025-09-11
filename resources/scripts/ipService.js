const https = require('https')
const { loggerService } = require('@logger')

const logger = loggerService.withContext('IpService')

/**
 * 获取用户的IP地址所在国家
 * @returns {Promise<string>} 返回国家代码，默认为'CN'
 */
async function getIpCountry() {
  return new Promise((resolve) => {
    // 添加超时控制
    const timeout = setTimeout(() => {
      logger.info('IP Address Check Timeout, default to China Mirror')
      resolve('CN')
    }, 5000)

    const options = {
      hostname: 'ipinfo.io',
      path: '/json',
      method: 'GET',
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9'
      }
    }

    const req = https.request(options, (res) => {
      clearTimeout(timeout)
      let data = ''

      res.on('data', (chunk) => {
        data += chunk
      })

      res.on('end', () => {
        try {
          const parsed = JSON.parse(data)
          const country = parsed.country || 'CN'
          logger.info(`Detected user IP address country: ${country}`)
          resolve(country)
        } catch (error) {
          logger.error('Failed to parse IP address information:', error.message)
          resolve('CN')
        }
      })
    })

    req.on('error', (error) => {
      clearTimeout(timeout)
      logger.error('Failed to get IP address information:', error.message)
      resolve('CN')
    })

    req.end()
  })
}

/**
 * 检查用户是否在中国
 * @returns {Promise<boolean>} 如果用户在中国返回true，否则返回false
 */
async function isUserInChina() {
  const country = await getIpCountry()
  return country.toLowerCase() === 'cn'
}

/**
 * 根据用户位置获取适合的npm镜像URL
 * @returns {Promise<string>} 返回npm镜像URL
 */
async function getNpmRegistryUrl() {
  const inChina = await isUserInChina()
  if (inChina) {
    logger.info('User in China, using Taobao npm mirror')
    return 'https://registry.npmmirror.com'
  } else {
    logger.info('User not in China, using default npm mirror')
    return 'https://registry.npmjs.org'
  }
}

module.exports = {
  getIpCountry,
  isUserInChina,
  getNpmRegistryUrl
}
