import { AxiosInstance, default as axios_ } from 'axios'

import { proxyManager } from './ProxyManager'

class AxiosProxy {
  private cacheAxios: AxiosInstance
  private proxyURL: string

  constructor() {
    this.proxyURL = proxyManager.getProxyUrl()
    this.cacheAxios = axios_.create({ proxy: false })
  }

  get axios(): AxiosInstance {
    if (this.proxyURL !== proxyManager.getProxyUrl()) {
      this.proxyURL = proxyManager.getProxyUrl()
      const agent = proxyManager.getProxyAgent()
      if (agent) {
        this.cacheAxios = axios_.create({ proxy: false, httpAgent: agent, httpsAgent: agent })
      } else {
        this.cacheAxios = axios_.create({ proxy: false })
      }
    }

    return this.cacheAxios
  }
}

export default new AxiosProxy()
