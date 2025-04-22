import { AxiosInstance, default as axios_ } from 'axios'
import { ProxyAgent } from 'proxy-agent'

import { proxyManager } from './ProxyManager'

class AxiosProxy {
  private cacheAxios: AxiosInstance | null = null
  private proxyAgent: ProxyAgent | null = null

  get axios(): AxiosInstance {
    const currentProxyAgent = proxyManager.getProxyAgent()

    // 如果代理发生变化或尚未初始化，则重新创建 axios 实例
    if (this.cacheAxios === null || (currentProxyAgent !== null && this.proxyAgent !== currentProxyAgent)) {
      this.proxyAgent = currentProxyAgent

      // 创建带有代理配置的 axios 实例
      this.cacheAxios = axios_.create({
        proxy: false,
        httpAgent: currentProxyAgent || undefined,
        httpsAgent: currentProxyAgent || undefined
      })
    }

    return this.cacheAxios
  }
}

export default new AxiosProxy()
