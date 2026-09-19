import type { UIMessageChunk } from 'ai'
import { describe, expect, it } from 'vitest'

import type { StreamChunkPayload } from '@shared/ai/transport'

import { capAttachReplayChunks, dropCoveredOverflow, MAX_ATTACH_REPLAY_CHUNKS } from '../capAttachReplay'

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

    const out = capAttachReplayChunks(bufferedChunks, MAX_ATTACH_REPLAY_CHUNKS).replay

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

    const out = capAttachReplayChunks(bufferedChunks, MAX_ATTACH_REPLAY_CHUNKS).replay

    expect(out.length).toBeLessThanOrEqual(MAX_ATTACH_REPLAY_CHUNKS)
  })
})

describe('dropCoveredOverflow', () => {
  const seqDelta = (seq: number, delta: string): StreamChunkPayload => ({
    topicId: 't',
    seq,
    chunk: { type: 'text-delta', id: 'p', delta }
  })

  it('drops pre-attach live chunks already covered by the replay snapshot', () => {
    // Main sent seqs 1-2 to a stale listener before the attach; the snapshot
    // replays them, so the overflow copies must not reach the reader twice.
    const replay = [seqDelta(1, 'a'), seqDelta(2, 'b')]
    const overflow = [seqDelta(1, 'a'), seqDelta(2, 'b'), seqDelta(3, 'c')]

    expect(dropCoveredOverflow(replay, overflow)).toEqual([seqDelta(3, 'c')])
  })

  it('keeps everything when no side carries sequence numbers', () => {
    // Seq-less payloads (older main, hand-built tests) cannot be compared, so
    // the filter stays a no-op instead of dropping live chunks it cannot place.
    const replay = [textDelta('p', 'a')]
    const overflow = [textDelta('p', 'a'), textDelta('p', 'b')]

    expect(dropCoveredOverflow(replay, overflow)).toEqual(overflow)
  })

  it('drops overflow older than a capped replay tail, like the cap itself', () => {
    // The cap deliberately discards old content; overflow must not resurrect
    // it — only chunks newer than the retained tail drain after replay.
    const replay = [seqDelta(100, 'tail'), seqDelta(101, 'tail')]
    const overflow = [seqDelta(50, 'old'), seqDelta(102, 'new')]

    expect(dropCoveredOverflow(replay, overflow)).toEqual([seqDelta(102, 'new')])
  })

  it('overflow handoff does not resurrect chunks replay repair intentionally dropped', () => {
    // The cap drops the orphan tool-input-delta (no resolvable opener), so the
    // retained replay watermark stops at seq 12 — yet the same orphan arrives
    // in the attach-time overflow with seq 13. Dropped by repair plus newer
    // than the watermark must still mean dropped from overflow.
    const orphanToolDelta = (seq: number): StreamChunkPayload => ({
      topicId: 't',
      seq,
      chunk: { type: 'tool-input-delta', toolCallId: 't1', inputTextDelta: 'x' } as unknown as UIMessageChunk
    })
    const buffered: StreamChunkPayload[] = [
      { topicId: 't', seq: 10, chunk: { type: 'text-start', id: 'p' } },
      seqDelta(11, 'a'),
      seqDelta(12, 'b'),
      orphanToolDelta(13)
    ]

    const { replay, droppedSeqs } = capAttachReplayChunks(buffered, 3)
    expect(droppedSeqs).toContain(13)

    const fresh = seqDelta(14, 'c')
    expect(dropCoveredOverflow(replay, [orphanToolDelta(13), fresh], droppedSeqs)).toEqual([fresh])
  })
})
