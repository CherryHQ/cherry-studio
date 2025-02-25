import { ProxyConfig as _ProxyConfig, session } from 'electron'
import { HttpsProxyAgent } from 'https-proxy-agent'

type ProxyMode = 'system' | 'custom' | 'none'

export interface ProxyConfig {
  mode: ProxyMode
  url?: string | null
}

export class ProxyManager {
  private config: ProxyConfig
  private proxyAgent: HttpsProxyAgent | null = null
  private proxyUrl: string | null = null

  constructor() {
    this.config = {
      mode: 'system',
      url: ''
    }
  }

  private async setSessionsProxy(config: _ProxyConfig): Promise<void> {
    const sessions = [session.defaultSession, session.fromPartition('persist:webview')]
    await Promise.all(sessions.map((session) => session.setProxy(config)))
  }

  async configureProxy(config: ProxyConfig): Promise<void> {
    try {
      this.config = config
      if (this.config.mode === 'system') {
        await this.setSystemProxy()
      } else if (this.config.mode == 'custom') {
        await this.setCustomProxy()
      } else {
        await this.clearProxy()
      }
    } catch (error) {
      console.error('Failed to config proxy:', error)
      throw error
    }
  }

  private setEnvironment(url: string): void {
    process.env.grpc_proxy = url
    process.env.HTTP_PROXY = url
    process.env.HTTPS_PROXY = url
    process.env.http_proxy = url
    process.env.https_proxy = url
  }

  private async setSystemProxy(): Promise<void> {
    try {
      this.proxyUrl = await this.resolveSystemProxy()
      if (this.proxyUrl) {
        this.proxyAgent = new HttpsProxyAgent(this.proxyUrl)
        this.setEnvironment(this.proxyUrl)
        await this.setSessionsProxy({ mode: 'system' })
      }
    } catch (error) {
      console.error('Failed to set system proxy:', error)
      throw error
    }
  }

  private async setCustomProxy(): Promise<void> {
    try {
      if (this.config.url) {
        this.proxyAgent = new HttpsProxyAgent(this.config.url)
        this.setEnvironment(this.config.url)
        await this.setSessionsProxy({ proxyRules: this.config.url })
      }
    } catch (error) {
      console.error('Failed to set custom proxy:', error)
      throw error
    }
  }

  private async clearProxy(): Promise<void> {
    delete process.env.HTTP_PROXY
    delete process.env.HTTPS_PROXY
    await this.setSessionsProxy({})
    this.config = { mode: 'none' }
  }

  private async resolveSystemProxy(): Promise<string | null> {
    try {
      return await this.resolveElectronProxy()
    } catch (error) {
      console.error('Failed to resolve system proxy:', error)
      return null
    }
  }

  private async resolveElectronProxy(): Promise<string | null> {
    try {
      const proxyString = await session.defaultSession.resolveProxy('https://dummy.com')
      const [protocol, address] = proxyString.split(';')[0].split(' ')
      return protocol === 'PROXY' ? `http://${address}` : null
    } catch (error) {
      console.error('Failed to resolve electron proxy:', error)
      return null
    }
  }

  getProxyAgent(): HttpsProxyAgent | null {
    return this.proxyAgent
  }

  getProxyUrl(): string | null {
    return this.proxyUrl
  }
}

export const proxyManager = new ProxyManager()
