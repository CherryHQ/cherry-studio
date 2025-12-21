import { describe, expect, it } from 'vitest'

import { shouldStartApiServerOnLaunch } from '../autoStart'

describe('shouldStartApiServerOnLaunch', () => {
  it('returns true when enabled', () => {
    expect(
      shouldStartApiServerOnLaunch(
        { enabled: true, autoStart: false, host: '127.0.0.1', port: 1234, apiKey: 'test' },
        0
      )
    ).toBe(true)
  })

  it('returns false when disabled and autoStart is false', () => {
    expect(
      shouldStartApiServerOnLaunch(
        { enabled: false, autoStart: false, host: '127.0.0.1', port: 1234, apiKey: 'test' },
        999
      )
    ).toBe(false)
  })

  it('returns false when disabled and there are no agents', () => {
    expect(
      shouldStartApiServerOnLaunch(
        { enabled: false, autoStart: true, host: '127.0.0.1', port: 1234, apiKey: 'test' },
        0
      )
    ).toBe(false)
  })

  it('returns true when disabled, autoStart is true, and agents exist', () => {
    expect(
      shouldStartApiServerOnLaunch(
        { enabled: false, autoStart: true, host: '127.0.0.1', port: 1234, apiKey: 'test' },
        1
      )
    ).toBe(true)
  })
})
