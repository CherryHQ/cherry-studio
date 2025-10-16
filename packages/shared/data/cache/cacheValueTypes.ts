import type { MinAppType, Topic, TranslateLanguageCode, WebSearchStatus } from '@types'
import type { UpdateInfo } from 'builder-util-runtime'

export type CacheAppUpdateState = {
  info: UpdateInfo | null
  checking: boolean
  downloading: boolean
  downloaded: boolean
  downloadProgress: number
  available: boolean
}

export type CacheActiveSearches = Record<string, WebSearchStatus>

// For cache schema, we use any for complex types to avoid circular dependencies
// The actual type checking will be done at runtime by the cache system
export type CacheMinAppType = MinAppType
export type CacheTopic = Topic
export type CacheTranslating =
  | {
      isTranslating: true
      abortKey: string
    }
  | {
      isTranslating: false
      abortKey: null
    }
export type CacheTranslateBidirectional = {
  enabled: boolean
  origin: TranslateLanguageCode
  target: TranslateLanguageCode
}
