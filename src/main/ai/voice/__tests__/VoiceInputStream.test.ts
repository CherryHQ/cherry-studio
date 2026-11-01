import { describe, expect, it } from 'vitest'

import { VoiceInputStream } from '../VoiceInputStream'

describe('PCM input handoff', () => {
  it('preserves order and the partial tail before EOF', async () => {
    const input = new VoiceInputStream()
    const iterator = input[Symbol.asyncIterator]()
    const first = input.write({ startFrame: 0, samples: new Float32Array([0.1, 0.2]) })
    expect((await iterator.next()).value?.samples).toEqual(new Float32Array([0.1, 0.2]))
    await first
    const tail = input.write({ startFrame: 2, samples: new Float32Array([0.3]) })
    expect((await iterator.next()).value?.startFrame).toBe(2)
    await tail
    input.finish(3)
    expect(await iterator.next()).toEqual({ done: true, value: undefined })
    await expect(input.write({ startFrame: 3, samples: new Float32Array([0]) })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
  })

  it('rejects overload, gaps and false EOF rather than losing audio', async () => {
    const input = new VoiceInputStream()
    const pending = input.write({ startFrame: 0, samples: new Float32Array(1600) })
    await expect(input.write({ startFrame: 1600, samples: new Float32Array(1) })).rejects.toMatchObject({
      reason: 'invalid_request'
    })
    expect(() => input.finish(1600)).toThrow()
    await input[Symbol.asyncIterator]().next()
    await pending
    await expect(input.write({ startFrame: 1601, samples: new Float32Array(1) })).rejects.toMatchObject({
      reason: 'invalid_audio'
    })
    expect(() => input.finish(1601)).toThrow()
    input.close()
  })

  it('cancellation rejects pending writes and wakes waiting readers', async () => {
    const input = new VoiceInputStream()
    const write = input.write({ startFrame: 0, samples: new Float32Array(1) })
    input.close()
    await expect(write).rejects.toMatchObject({ reason: 'aborted' })
    const waiting = new VoiceInputStream()
    const next = waiting[Symbol.asyncIterator]().next()
    waiting.close()
    await expect(next).rejects.toMatchObject({ reason: 'aborted' })
  })
})
