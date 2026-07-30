import { describe, expect, it } from 'vitest'

import { AddPracticeAttemptSchema, ImportSelectionActionResultSchema } from '../englishLearning'

describe('english learning data API schemas', () => {
  it('accepts a selection action name when importing personalized assistant results', () => {
    expect(
      ImportSelectionActionResultSchema.safeParse({
        actionId: 'custom-polish',
        actionName: '润色',
        selectedText: 'This sentence need polish.',
        outputText: 'This sentence needs polishing.'
      }).success
    ).toBe(true)
  })

  it('accepts pronunciation diagnostics on practice attempts', () => {
    const result = AddPracticeAttemptSchema.safeParse({
      prompt: 'Could you say that again?',
      transcript: 'Could you say that again',
      feedback: {
        correctedText: 'Could you say that again?',
        feedback: ['Natural phrasing.'],
        pronunciation: {
          source: 'transcript_only',
          pronunciation: 'Transcript-only evaluation cannot judge pronunciation directly.',
          stress: 'No audio-based stress diagnosis available.',
          intonation: 'No audio-based intonation diagnosis available.',
          pace: 'No audio-based pace diagnosis available.',
          wordLevelNotes: []
        },
        textSimilarity: 1
      },
      textSimilarity: 1,
      durationMs: 0
    })

    expect(result.success).toBe(true)
  })
})
