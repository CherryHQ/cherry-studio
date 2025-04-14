// import { DIFY_INFO } from '@dify-chat/helpers'
import { message } from 'antd'

const DIFY_VERSION_KEY = 'DIFY_CHAT__DIFY_VERSION'

/**
 * 获取 Dify 版本
 */
export const DIFY_INFO = {
  get version() {
    return localStorage.getItem(DIFY_VERSION_KEY) || ''
  },

  set version(version: string) {
    localStorage.setItem(DIFY_VERSION_KEY, version)
  }
}

/**
 * 未授权错误类
 */
export class UnauthorizedError extends Error {
  constructor(message: string) {
    super('Unauthorized')
    this.name = 'UnauthorizedError'
    this.message = message
  }
}

export class XRequest {
  constructor(options: { baseURL: string; apiKey: string }) {
    this.options = options
  }

  options: {
    baseURL: string
    apiKey: string
  }

  async baseRequest(url: string, options: RequestInit) {
    const result = await fetch(`${this.options.baseURL}${url}`, {
      ...options,
      headers: {
        ...options.headers,
        Authorization: `Bearer ${this.options.apiKey}`
      }
    })
    if (result.headers.get('X-Version')) {
      const newDifyVersion = result.headers.get('X-Version')
      // 比较本地缓存的版本和当前版本
      if (newDifyVersion && newDifyVersion !== DIFY_INFO.version) {
        DIFY_INFO.version = newDifyVersion
      }
    }
    if (result.status === 401) {
      message.error('未授权, 请检查你的配置')
      throw new UnauthorizedError('Unauthorized')
    }
    return result
  }

  async jsonRequest(url: string, options: RequestInit) {
    const result = await this.baseRequest(url, {
      ...options,
      headers: {
        ...options.headers,
        'Content-Type': 'application/json'
      }
    })
    return result.json()
  }

  async get(url: string, params?: Record<string, string>, headers: Record<string, string> = {}) {
    const queryString = params ? `?${new URLSearchParams(params).toString()}` : ''
    const result = await this.jsonRequest(`${url}${queryString}`, {
      method: 'GET',
      headers
    })
    return result
  }

  async post(url: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
    const result = await this.jsonRequest(url, {
      method: 'POST',
      body: JSON.stringify(params),
      headers
    })
    return result
  }

  async delete(url: string, params?: Record<string, unknown>, headers: Record<string, string> = {}) {
    const result = await this.jsonRequest(url, {
      method: 'DELETE',
      body: JSON.stringify(params),
      headers
    })
    return result
  }
}

export default XRequest
