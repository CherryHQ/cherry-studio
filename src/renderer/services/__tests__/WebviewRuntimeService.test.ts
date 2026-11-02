import type { WebviewTag } from 'electron'
import { describe, expect, it } from 'vitest'

import { WebviewRuntimeService, type WebviewRequest } from '../WebviewRuntimeService'

const demand = (key: string, patch: Partial<WebviewRequest> = {}): WebviewRequest => ({
  key,
  source: { src: `https://${key}.example`, partition: 'persist:webview' },
  visible: true,
  protected: false,
  lastAccessTime: 0,
  ...patch
})

describe('WebView resource lifetime', () => {
  it('releases unowned resources while keeping referenced guests unchanged', () => {
    const service = new WebviewRuntimeService()
    service.sync([demand('a'), demand('b')], 10)
    const b = service.get('b')!
    const guest = {} as WebviewTag
    service.bind('b', b.instance, guest)
    service.reportLoaded('b', b.instance, true)
    service.sync([demand('b')], 10)
    expect(service.get('a')).toBeUndefined()
    expect(service.get('b')).toMatchObject({ instance: b.instance, element: guest, loaded: true })
    service.release('b')
    expect(service.getSnapshot()).toEqual([])
  })

  it('does not recreate an evicted background page until it is presented', () => {
    const service = new WebviewRuntimeService()
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
    const service = new WebviewRuntimeService()
    service.sync([demand('a'), demand('b')], 1)
    expect(service.getSnapshot().map((resource) => resource.key)).toEqual(['a', 'b'])
    service.sync([demand('a'), demand('b', { visible: false })], 1)
    expect(service.get('b')).toBeUndefined()
  })

  it('rejects old load and ref callbacks after closing and reopening the same app', () => {
    const service = new WebviewRuntimeService()
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
    const service = new WebviewRuntimeService()
    service.sync([demand('b'), demand('a')], 10)
    const ids = service.getSnapshot().map((resource) => resource.instance)
    service.sync([demand('a', { lastAccessTime: 3 }), demand('b')], 10)
    expect(service.getSnapshot().map((resource) => resource.instance)).toEqual(ids)
    const a = service.get('a')!
    service.bind('a', a.instance, {} as WebviewTag)
    service.reportLoaded('a', a.instance, true)
    service.sync([demand('a', { source: { ...a.source, src: 'https://updated.example' } }), demand('b')], 10)
    expect(service.get('a')).toMatchObject({
      instance: a.instance,
      loaded: false,
      source: { src: 'https://updated.example' }
    })
  })
  it('replaces the guest when its security partition changes', () => {
    const service = new WebviewRuntimeService()
    service.sync([demand('a')], 10)
    const old = service.get('a')!
    service.bind('a', old.instance, {} as WebviewTag)
    service.reportLoaded('a', old.instance, true)
    service.sync([demand('a', { source: { ...old.source, partition: 'isolated' } })], 10)
    const current = service.get('a')!
    expect(current.instance).not.toBe(old.instance)
    expect(current.element).toBeNull()
    expect(current.loaded).toBe(false)
    service.reportLoaded('a', old.instance, true)
    expect(service.get('a')!.loaded).toBe(false)
  })

  it('keeps protected background resources but releases them once unowned', () => {
    const service = new WebviewRuntimeService()
    service.sync([demand('a')], 1)
    const guest = {} as WebviewTag
    const instance = service.get('a')!.instance
    service.bind('a', instance, guest)
    service.sync([demand('a', { visible: false, protected: true }), demand('b')], 1)
    expect(service.get('a')).toMatchObject({ instance, element: guest })
    service.sync([demand('b')], 1)
    expect(service.get('a')).toBeUndefined()
  })

  it('waits for a source without discarding an already known source', () => {
    const service = new WebviewRuntimeService()
    service.sync([demand('a', { source: undefined })], 1)
    expect(service.get('a')).toBeUndefined()
    service.sync([demand('a')], 1)
    const existing = service.get('a')!
    service.sync([demand('a', { source: undefined })], 1)
    expect(service.get('a')).toBe(existing)
  })
})
