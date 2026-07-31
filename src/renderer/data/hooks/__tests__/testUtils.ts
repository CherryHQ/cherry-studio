import React from 'react'
import { SWRConfig, unstable_serialize } from 'swr'
import { vi } from 'vitest'

export function createSWRTestWrapper(initial?: Array<[unknown[], unknown]>) {
  const cache = new Map<string, { data?: unknown }>()
  for (const [key, value] of initial ?? []) {
    cache.set(unstable_serialize(key), { data: value })
  }
  const provider = () => cache
  const Wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(
      SWRConfig,
      { value: { provider, dedupingInterval: 0, revalidateOnFocus: false, revalidateOnReconnect: false } },
      children
    )
  return { Wrapper, cache }
}

export function installCacheApiMock(broadcastSync = vi.fn()) {
  Object.defineProperty(window, 'api', {
    configurable: true,
    value: {
      cache: {
        broadcastSync,
        onSync: vi.fn(),
        onSyncBatch: vi.fn(),
        getAllShared: vi.fn(async () => ({}))
      }
    }
  })
  return broadcastSync
}
