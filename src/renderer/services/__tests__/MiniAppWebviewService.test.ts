import type { WebviewTag } from 'electron'
import { describe, expect, it } from 'vitest'

import { MiniAppWebviewService, type MiniAppDemand } from '../MiniAppWebviewService'

const demand = (appId: string, patch: Partial<MiniAppDemand> = {}): MiniAppDemand => ({
  appId,
  app: {
    appId,
    kind: 'site',
    name: appId,
    url: `https://${appId}.example`,
    presetMiniAppId: null,
    status: 'enabled',
    orderKey: ''
  },
  awake: true,
  visible: true,
  protected: false,
  lastAccessTime: 0,
  ...patch
})

describe('MiniApp resource lifetime', () => {
  it('releases unowned resources while keeping referenced guests unchanged', () => {
    const service = new MiniAppWebviewService()
    service.sync([demand('a'), demand('b')], 10)
    const b = service.get('b')!
    const guest = {} as WebviewTag
    service.bind('b', b.instance, guest)
    service.reportLoaded('b', b.instance, true)
    service.sync([demand('b')], 10)
    expect(service.get('a')).toBeUndefined()
    expect(service.get('b')).toMatchObject({ instance: b.instance, element: guest, loaded: true })
    service.sync([], 10)
    expect(service.getSnapshot()).toEqual([])
  })

  it('does not recreate an evicted background page until it is presented', () => {
    const service = new MiniAppWebviewService()
    service.sync([demand('a')], 1)
    const instance = service.get('a')!.instance
    const background = demand('a', { visible: false })
    service.sync([background, demand('b', { lastAccessTime: 2 })], 1)
    service.sync([background, demand('b', { lastAccessTime: 2 })], 1)
    expect(service.get('a')).toBeUndefined()
    service.sync([demand('a'), demand('b', { visible: false })], 1)
    expect(service.get('a')!.instance).not.toBe(instance)
    expect(service.get('b')).toBeUndefined()
  })

  it('protects both visible panes even when the capacity is one', () => {
    const service = new MiniAppWebviewService()
    service.sync([demand('a'), demand('b')], 1)
    expect(service.getSnapshot().map((resource) => resource.app.appId)).toEqual(['a', 'b'])
    service.sync([demand('a'), demand('b', { visible: false, awake: false })], 1)
    expect(service.get('b')).toBeUndefined()
  })

  it('rejects old load and ref callbacks after closing and reopening the same app', () => {
    const service = new MiniAppWebviewService()
    service.sync([demand('a')], 1)
    const old = service.get('a')!
    service.sync([], 1)
    service.sync([demand('a')], 1)
    const current = service.get('a')!
    const guest = {} as WebviewTag
    service.bind('a', current.instance, guest)
    service.reportLoaded('a', old.instance, true)
    service.bind('a', old.instance, null)
    expect(service.get('a')).toMatchObject({ element: guest, loaded: false })
    service.reportLoaded('a', current.instance, true)
    service.bind('a', old.instance, {} as WebviewTag)
    expect(service.get('a')).toMatchObject({ element: guest, loaded: true })
  })

  it('preserves guest order and identity on LRU touches, and navigates updated descriptors', () => {
    const service = new MiniAppWebviewService()
    service.sync([demand('b'), demand('a')], 10)
    const ids = service.getSnapshot().map((resource) => resource.instance)
    service.sync([demand('a', { lastAccessTime: 3 }), demand('b')], 10)
    expect(service.getSnapshot().map((resource) => resource.instance)).toEqual(ids)
    const a = service.get('a')!
    service.bind('a', a.instance, {} as WebviewTag)
    service.reportLoaded('a', a.instance, true)
    service.sync([demand('a', { app: { ...a.app, url: 'https://updated.example' } }), demand('b')], 10)
    expect(service.get('a')).toMatchObject({
      instance: a.instance,
      loaded: false,
      app: { url: 'https://updated.example' }
    })
  })
})
