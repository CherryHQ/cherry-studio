import { beforeEach, describe, expect, it } from 'vitest'

import { isBlockedByAdblock, setAdblockGate } from '../gate'

const details = (url: string, resourceType = 'script') =>
  ({ url, resourceType }) as Electron.OnBeforeRequestListenerDetails

describe('the ad-block gate', () => {
  beforeEach(() => setAdblockGate(undefined))

  it('answers false until a service installs a gate', () => {
    expect(isBlockedByAdblock(details('https://ads.example.com/a.js'))).toBe(false)
  })

  it('delegates to the installed gate', () => {
    setAdblockGate((request) => request.url.includes('ads'))
    expect(isBlockedByAdblock(details('https://ads.example.com/a.js'))).toBe(true)
    expect(isBlockedByAdblock(details('https://example.com/app.js'))).toBe(false)
  })

  it('fails open when the gate throws', () => {
    setAdblockGate(() => {
      throw new Error('engine exploded')
    })
    expect(isBlockedByAdblock(details('https://ads.example.com/a.js'))).toBe(false)
  })

  it('stops answering once the gate is cleared', () => {
    setAdblockGate(() => true)
    setAdblockGate(undefined)
    expect(isBlockedByAdblock(details('https://ads.example.com/a.js'))).toBe(false)
  })
})
