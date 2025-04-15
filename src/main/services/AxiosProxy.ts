import { AxiosInstance, default as axios_ } from 'axios'

import { proxyManager } from './ProxyManager'

class AxiosProxy {
  private cacheAxios: AxiosInstance | undefined
  private proxyURL: string | undefined

  get axios(): AxiosInstance {
    const currentProxyURL = proxyManager.getProxyUrl()
    if (this.proxyURL !== currentProxyURL) {
      this.proxyURL = currentProxyURL
      const agent = proxyManager.getProxyAgent()
      this.cacheAxios = axios_.create({
        proxy: false,
        ...(agent && { httpAgent: agent, httpsAgent: agent })
      })
    }

    if (this.cacheAxios === undefined) {
      this.cacheAxios = axios_.create({ proxy: false })
    }
    return this.cacheAxios
  }
}

export default new AxiosProxy()
