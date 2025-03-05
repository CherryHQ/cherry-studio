// 这是针对@types/cacheable-request包中类型错误的修复，用于覆盖原有定义
import { ServerResponse } from 'http'
import { Readable } from 'stream'
import { URL } from 'url'

declare module 'cacheable-request' {
  export interface CacheableRequest {
    (options: URL | string | object, callback?: (response: ServerResponse | ResponseLike) => void): Readable
  }

  export interface ResponseLike {
    body: any
    headers: any
    url: string
    status: number
    statusCode: number
    ok: boolean
  }

  export interface Options {
    cache?: any
    strictTtl?: boolean
    automaticFailover?: boolean
    forceRefresh?: boolean
    get?: any
    set?: any
    delete?: any
    maxAge?: number
  }

  const cacheableRequest: {
    (request: any): CacheableRequest
    new (request: any): CacheableRequest
  }

  export default cacheableRequest
}

// 声明与@types/cacheable-request兼容的模块
declare module '@types/cacheable-request' {
  export * from 'cacheable-request'
}
