import { describe, expect, it } from 'vitest'

import { COMPUTER_USE_APP_META_KEY, getComputerUseApp } from '../computerUse'

describe('computer use app metadata', () => {
  it('reads only the explicitly namespaced target, not a screenshot or unrelated app field', () => {
    const app = {
      name: 'Finder',
      bundleIdentifier: 'com.apple.finder',
      icon: { mimeType: 'image/png', data: 'aWNvbg==' }
    }
    expect(getComputerUseApp({ _meta: { [COMPUTER_USE_APP_META_KEY]: app } })).toEqual(app)
    expect(
      getComputerUseApp({ app, content: [{ type: 'image', data: 'aWNvbg==', mimeType: 'image/png' }] })
    ).toBeUndefined()
  })

  it.each([
    { mimeType: 'image/svg+xml', data: 'aWNvbg==' },
    { mimeType: 'image/png', data: 'https://example.com/icon.png' },
    { mimeType: 'image/png', data: 'a'.repeat(65537) }
  ])('rejects unsupported or oversized icon payloads', (icon) => {
    expect(getComputerUseApp({ _meta: { [COMPUTER_USE_APP_META_KEY]: { name: 'Finder', icon } } })).toBeUndefined()
  })
})
