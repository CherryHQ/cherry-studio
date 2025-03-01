// 这是对@types/cacheable-request中类型错误的修复
import { ServerResponse } from 'http'

declare module 'cacheable-request' {
  export default function cacheableRequest(request: any): any

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

  export interface CacheableRequest {
    (options: object | string, callback?: (response: ServerResponse | ResponseLike) => void): any
    (url: URL | string, options?: object, callback?: (response: ServerResponse | ResponseLike) => void): any
  }
}
