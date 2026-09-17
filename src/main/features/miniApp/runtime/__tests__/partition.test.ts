import { describe, expect, it } from 'vitest'

import { isMiniAppPartition, miniAppIdOfPartition, miniAppPartition } from '../partition'

const APP = 'com.example.a'

describe('mini app partitions', () => {
  it('gives every app its own persistent partition', () => {
    expect(miniAppPartition(APP)).toBe(`persist:miniapp:${APP}`)
    expect(miniAppPartition(APP)).not.toBe(miniAppPartition('com.example.b'))
  })

  it('round-trips the app id', () => {
    // Both halves live here precisely so they cannot drift: a prefix written out twice is
    // two strings that must agree with nothing making them.
    expect(miniAppIdOfPartition(miniAppPartition(APP))).toBe(APP)
  })

  it('recognises only a partition that STARTS with the prefix', () => {
    // The distinction generic hardening reads: a partition merely CONTAINING the prefix is
    // some other feature's, and skipping it would leave that one unhardened instead.
    expect(isMiniAppPartition(miniAppPartition(APP))).toBe(true)
    expect(isMiniAppPartition(`x-persist:miniapp:${APP}`)).toBe(false)
    expect(isMiniAppPartition('persist:webview')).toBe(false)
  })

  it('treats an absent partition as belonging to no mini app', () => {
    expect(isMiniAppPartition(undefined)).toBe(false)
  })
})
