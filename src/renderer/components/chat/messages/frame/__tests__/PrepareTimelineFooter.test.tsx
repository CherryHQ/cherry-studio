import type { PrepareProgressPartData, PrepareTimeline } from '@shared/ai/agentPrepareTimeline'
import type { CherryMessagePart } from '@shared/data/types/message'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@cherrystudio/ui', () => ({ Button: (props: Record<string, unknown>) => props.children }))
vi.mock('@renderer/ipc', () => ({ ipcApi: { request: vi.fn() } }))
vi.mock('@renderer/services/toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const { selectFooterPrepareTimeline } = await import('../PrepareTimelineFooter')

function progressPart(data: PrepareProgressPartData): CherryMessagePart {
  return { type: 'data-prepare-progress', id: 'cs-prepare-progress', data } as unknown as CherryMessagePart
}

const slowTimeline: PrepareTimeline = {
  totalMs: 6000,
  stages: [{ stage: 'spawn-to-init', ms: 6000 }],
  runtimeType: 'claude-code'
}

describe('selectFooterPrepareTimeline', () => {
  it('returns the timeline when a finalized total exceeds the 5s threshold', () => {
    const parts = [progressPart({ phase: 'waiting-first-response', timeline: slowTimeline })]
    expect(selectFooterPrepareTimeline(parts)).toBe(slowTimeline)
  })

  it('returns undefined for a fast prepare at or below the threshold', () => {
    const parts = [
      progressPart({
        phase: 'waiting-first-response',
        timeline: { totalMs: 5000, stages: [{ stage: 'spawn-to-init', ms: 5000 }] }
      })
    ]
    expect(selectFooterPrepareTimeline(parts)).toBeUndefined()
  })

  it('returns undefined for a live part that has not finalized a timeline yet', () => {
    const parts = [progressPart({ phase: 'starting-runtime' })]
    expect(selectFooterPrepareTimeline(parts)).toBeUndefined()
  })

  it('ignores unrelated parts', () => {
    const parts = [{ type: 'text', text: 'hi' } as unknown as CherryMessagePart]
    expect(selectFooterPrepareTimeline(parts)).toBeUndefined()
  })
})
