import type { LearningUnit } from '@shared/data/types/englishLearning'
import { describe, expect, it } from 'vitest'

import { resolveObsidianMirrorRoot } from '../ObsidianLearningSyncService'
import { renderDailyLearningLog, renderLearningUnitNote, renderObsidianDashboard } from '../obsidianMarkdown'

const unit: LearningUnit = {
  id: '01984f16-086b-7df0-b9d4-a443d7603888',
  kind: 'expression',
  english: 'Could you give me a hand?',
  normalizedEnglish: 'could you give me a hand?',
  meaning: '你能帮我一下吗？',
  usageNote: 'A natural informal request.',
  example: 'Could you give me a hand with these boxes?',
  tags: ['request'],
  cefr: 'B1',
  exactHash: 'hash',
  extractionConfidence: 0.98,
  isUserEdited: false,
  suspended: false,
  createdAt: '2026-07-28T00:00:00.000Z',
  updatedAt: '2026-07-28T01:00:00.000Z'
}

describe('Obsidian learning mirror', () => {
  it('renders stable unit frontmatter and learning content', () => {
    const note = renderLearningUnitNote(unit)

    expect(note).toContain(`cherry_id: "${unit.id}"`)
    expect(note).toContain('tags: ["cherry-english","request"]')
    expect(note).toContain('# Could you give me a hand?')
    expect(note).toContain('Review state is managed by Cherry Studio')
  })

  it('renders a Dataview dashboard and a daily activity log', () => {
    expect(renderObsidianDashboard()).toContain('```dataview')
    const log = renderDailyLearningLog({
      date: '2026-07-28',
      reviews: [{ english: unit.english, rating: 'good', direction: 'production' }],
      practices: [{ mode: 'scenario', durationMs: 125_000, scenario: 'Hotel check-in' }]
    })
    expect(log).toContain('production, good')
    expect(log).toContain('scenario — Hotel check-in (2 min)')
  })

  it('rejects an absolute or escaping mirror folder', () => {
    expect(resolveObsidianMirrorRoot('/vault', 'Cherry English')).toBe('/vault/Cherry English')
    expect(() => resolveObsidianMirrorRoot('/vault', '../outside')).toThrow('stay inside')
    expect(() => resolveObsidianMirrorRoot('/vault', '/outside')).toThrow('must be relative')
  })
})
