import { afterEach, describe, expect, it, vi } from 'vitest'

import { CherryCloudLoopbackCallback } from '../loopbackCallback'

describe('CherryCloudLoopbackCallback', () => {
  let receiver: CherryCloudLoopbackCallback | null = null

  afterEach(() => receiver?.dispose())

  it('accepts one callback on an ephemeral 127.0.0.1 port', async () => {
    const callback = vi.fn(async (url: URL): Promise<void> => {
      void url
    })
    receiver = await CherryCloudLoopbackCallback.open(callback, 'http://127.0.0.1:8084')

    const ignored = await fetch(`http://127.0.0.1:${receiver.port}/other`)
    expect(ignored.status).toBe(404)

    const response = await fetch(
      `http://127.0.0.1:${receiver.port}/cloud-auth/callback?authorization_id=id&state=state&handoff_code=code`,
      { redirect: 'manual' }
    )
    expect(response.status).toBe(303)
    expect(response.headers.get('location')).toBe('http://127.0.0.1:8084/login/complete#desktop_result=success')
    expect(callback).toHaveBeenCalledTimes(1)
    expect(callback.mock.calls[0][0].toString()).toBe(
      'cherrystudio://cloud-auth/callback?authorization_id=id&state=state&handoff_code=code'
    )
  })

  it('keeps listening when callback validation fails', async () => {
    const callback = vi.fn(async (url: URL) => {
      if (url.searchParams.get('state') === 'wrong') throw new Error('invalid callback')
    })
    receiver = await CherryCloudLoopbackCallback.open(callback, 'http://127.0.0.1:8084')

    const invalid = await fetch(`http://127.0.0.1:${receiver.port}/cloud-auth/callback?state=wrong`, {
      redirect: 'manual'
    })
    expect(invalid.status).toBe(303)
    expect(invalid.headers.get('location')).toBe('http://127.0.0.1:8084/login/complete#desktop_result=invalid')

    const valid = await fetch(`http://127.0.0.1:${receiver.port}/cloud-auth/callback?state=expected`, {
      redirect: 'manual'
    })
    expect(valid.status).toBe(303)
    expect(valid.headers.get('location')).toBe('http://127.0.0.1:8084/login/complete#desktop_result=success')
    expect(callback).toHaveBeenCalledTimes(2)
  })
})
