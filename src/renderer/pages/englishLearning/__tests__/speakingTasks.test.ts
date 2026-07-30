import { describe, expect, it } from 'vitest'

import { buildCardTargetLine, getCardSpeakingTaskKey, normalizeCefr } from '../speakingTasks'

describe('speakingTasks', () => {
  it('normalizes missing, lowercase, and invalid CEFR levels', () => {
    expect(normalizeCefr(null)).toBe('B1')
    expect(normalizeCefr(' c1 ')).toBe('C1')
    expect(normalizeCefr('native')).toBe('B1')
  })

  it('upgrades card-driven speaking tasks by CEFR and practice mode', () => {
    expect(getCardSpeakingTaskKey('spoken_recall', { cefr: 'B1', english: 'x', meaning: 'y' })).toBe(
      'spoken_recall_intermediate'
    )
    expect(getCardSpeakingTaskKey('spoken_recall', { cefr: 'C1', english: 'x', meaning: 'y' })).toBe(
      'spoken_recall_advanced'
    )
    expect(getCardSpeakingTaskKey('shadowing', { cefr: 'B2', english: 'x', meaning: 'y' })).toBe(
      'shadowing_independent'
    )
    expect(getCardSpeakingTaskKey('scenario', { cefr: 'A2', english: 'x', meaning: 'y' })).toBe('scenario_beginner')
  })

  it('builds model-facing target lines with normalized CEFR', () => {
    expect(buildCardTargetLine({ cefr: 'c2', english: 'Make it work.', meaning: '让它可行。' })).toBe(
      '[C2] Make it work. (让它可行。)'
    )
  })
})
