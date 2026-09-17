import { describe, expect, it } from 'vitest'

import type { StreamChunkPayload } from '@shared/ai/transport'

import { capAttachReplayChunks, MAX_ATTACH_REPLAY_CHUNKS } from '../capAttachReplay'

function textDelta(id: string, delta: string): StreamChunkPayload {
  return { topicId: 't', chunk: { type: 'text-delta', id, delta } }
}

describe('capAttachReplayChunks', () => {
  it('delivers at most max chunks while keeping every retained delta parseable', () => {
    // 100 text parts × (start + 11 deltas): the cap cut lands mid-run, so the
    // retained tail needs a synthesized opener on top of the tail budget.
    const bufferedChunks: StreamChunkPayload[] = []
    for (let p = 0; p < 100; p++) {
      bufferedChunks.push({ topicId: 't', chunk: { type: 'text-start', id: `p${p}` } })
      for (let d = 0; d < 11; d++) bufferedChunks.push(textDelta(`p${p}`, `p${p}-d${d}`))
    }

    const out = capAttachReplayChunks(bufferedChunks, MAX_ATTACH_REPLAY_CHUNKS)

    // The bound holds with the synthesized opener included, not just the tail.
    expect(out.length).toBeLessThanOrEqual(MAX_ATTACH_REPLAY_CHUNKS)
    // The newest chunk is never sacrificed for the bound.
    expect(out[out.length - 1]).toEqual(bufferedChunks[bufferedChunks.length - 1])
    // Every retained delta still has its opener ahead of it.
    const open = new Set<string>()
    for (const { chunk } of out) {
      if (chunk.type === 'text-start') open.add(chunk.id)
      else if (chunk.type === 'text-delta') expect(open.has(chunk.id)).toBe(true)
    }
  })

  it('stays bounded when every retained chunk is an orphaned delta', () => {
    // Adversarial: 1200 distinct single-delta parts whose openers were all cut.
    const bufferedChunks = Array.from({ length: 1200 }, (_, i) => textDelta(`p${i}`, `d${i}`))

    const out = capAttachReplayChunks(bufferedChunks, MAX_ATTACH_REPLAY_CHUNKS)

    expect(out.length).toBeLessThanOrEqual(MAX_ATTACH_REPLAY_CHUNKS)
  })
})
