import { describe, expect, it } from 'vitest'

import { VoiceTextInput } from '../VoiceTextInput'

describe('incremental speech input', () => {
  it('delivers the initial segment, preserves event order and requires exact EOF', async () => {
    const input = new VoiceTextInput('Hello.')
    const reader = input[Symbol.asyncIterator]()
    expect((await reader.next()).value).toEqual({ type: 'text', text: 'Hello.' })
    expect((await reader.next()).value).toEqual({ type: 'flush' })
    let acknowledged = false
    const written = input.write(0, { type: 'text', text: 'Next.' }).then(() => {
      acknowledged = true
    })
    await Promise.resolve()
    expect(acknowledged).toBe(false)
    await expect(input.write(1, { type: 'flush' })).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(() => input.finish(1)).toThrow()
    expect((await reader.next()).value).toEqual({ type: 'text', text: 'Next.' })
    await written
    await expect(input.write(0, { type: 'flush' })).rejects.toMatchObject({ reason: 'invalid_request' })
    expect(() => input.finish(0)).toThrow()
    input.finish(1)
    expect((await reader.next()).done).toBe(true)
  })

  it('releases both a pending reader and blocked writer on cancellation', async () => {
    const input = new VoiceTextInput('Hello.')
    const reader = input[Symbol.asyncIterator]()
    await reader.next()
    await reader.next()
    const pending = reader.next()
    input.close()
    await expect(pending).rejects.toMatchObject({ reason: 'aborted' })
    const other = new VoiceTextInput('Hello.')
    const write = other.write(0, { type: 'flush' })
    other.close()
    await expect(write).rejects.toMatchObject({ reason: 'aborted' })
  })

  it('limits cumulative text and per-frame size before accepting more input', async () => {
    const input = new VoiceTextInput('a'.repeat(4999))
    await expect(input.write(0, { type: 'text', text: 'ab' })).rejects.toMatchObject({ reason: 'invalid_request' })
    await expect(input.write(0, { type: 'text', text: 'a'.repeat(2049) })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
  })
})
