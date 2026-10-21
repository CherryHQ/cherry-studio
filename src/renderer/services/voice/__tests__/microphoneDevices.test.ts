import { afterEach, describe, expect, it, vi } from 'vitest'

import { enumerateMicrophones, microphoneErrorReason, subscribeMicrophoneChanges } from '../microphoneDevices'

afterEach(() => vi.unstubAllGlobals())

describe('microphone device discovery', () => {
  it('enumerates audio inputs without opening a stream or duplicating system default', async () => {
    const devices = Object.assign(new EventTarget(), {
      enumerateDevices: async () => [
        { kind: 'audioinput', deviceId: 'default', label: 'Default' },
        { kind: 'audioinput', deviceId: 'usb', label: 'USB' },
        { kind: 'audioinput', deviceId: 'hidden', label: '' },
        { kind: 'audiooutput', deviceId: 'speaker', label: 'Speaker' },
        { kind: 'videoinput', deviceId: 'camera', label: 'Camera' }
      ]
    })
    vi.stubGlobal('navigator', { mediaDevices: devices })
    expect(await enumerateMicrophones()).toEqual([
      { deviceId: 'usb', label: 'USB' },
      { deviceId: 'hidden', label: '' }
    ])
    let revision = 0
    const unsubscribe = subscribeMicrophoneChanges(() => revision++)
    devices.dispatchEvent(new Event('devicechange'))
    unsubscribe()
    devices.dispatchEvent(new Event('devicechange'))
    expect(revision).toBe(1)
  })

  it.each([
    ['NotAllowedError', 'microphone_permission'],
    ['NotReadableError', 'microphone_unreadable'],
    ['NotFoundError', 'microphone_unavailable'],
    ['UnknownError', 'recording_failed']
  ])('normalizes %s without exposing browser details', (name, reason) => {
    expect(microphoneErrorReason(new DOMException('private device details', name))).toBe(reason)
  })

  it('distinguishes a missing selected device from other unsupported constraints', () => {
    expect(
      microphoneErrorReason(
        Object.assign(new DOMException('private', 'OverconstrainedError'), { constraint: 'deviceId' })
      )
    ).toBe('microphone_unavailable')
    expect(
      microphoneErrorReason(
        Object.assign(new DOMException('private', 'OverconstrainedError'), { constraint: 'sampleRate' })
      )
    ).toBe('recording_failed')
  })
})
