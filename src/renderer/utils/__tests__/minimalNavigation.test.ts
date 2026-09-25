import { describe, expect, it } from 'vitest'

import type { Tab } from '@shared/data/cache/cacheValueTypes'

import { findMinimalFeatureTab } from '../minimalNavigation'

const tab = (id: string, url: string, lastAccessTime = 0): Tab => ({
  id,
  url,
  lastAccessTime,
  type: 'route',
  title: ''
})

describe('minimal feature selection', () => {
  it('resumes the most recently used detail page without losing its route', () => {
    const older = tab('older', '/app/notes/first', 1)
    const recent = tab('recent', '/app/notes/second', 2)
    expect(findMinimalFeatureTab([older, recent], '/app/notes')).toBe(recent)
  })

  it('resumes settings from any section', () => {
    const settings = tab('settings', '/settings/model')
    expect(findMinimalFeatureTab([settings], '/settings/labs')).toBe(settings)
  })

  it('keeps different mini apps and code tools separate', () => {
    const miniApp = tab('one', '/app/mini-app/one')
    const harness = tab('harness', '/app/code?tool=deepseek-harness')
    expect(findMinimalFeatureTab([miniApp], '/app/mini-app/two')).toBeUndefined()
    expect(findMinimalFeatureTab([harness], '/app/code')).toBeUndefined()
    expect(findMinimalFeatureTab([harness], '/app/code?tool=deepseek-harness')).toBe(harness)
  })
})
